/**
 * The words sent by the event page's Share button (VC-41, founder approval
 * 2026-10-27: "share sheet now, deep links once the domain exists").
 *
 * What it does: builds a short message from an event's PUBLIC facts only,
 * the name, the neighbourhood (and state) and the day and time, for the
 * phone's own share sheet (React Native's Share API).
 *
 * Privacy rule: the message must NEVER include the party code or the map
 * pin. The builder copies only the fields it names (it never loops over
 * the event or prints it whole), so even if an event object ever carried
 * a code or coordinates, they could not leak into the message. The app
 * can't read those secrets anyway (they live in event_private, VC-20).
 */
import { dateInputFor, readableDay } from '@/lib/event-form';
import { formatClock } from '@/lib/tonight';
import type { PublicEvent } from '@/lib/tonight';

/**
 * A link added to the end of every shared message, once there is one.
 *
 * Empty for now: VibeCheck has no web domain or store listing yet. Later
 * it gets the App Store / TestFlight link, or a universal link that opens
 * the event in the app (the full VC-41 in the backlog). While it is empty,
 * nothing is added.
 */
export const SHARE_LINK = '';

/** The facts the message uses (and nothing else). */
export type ShareableEvent = Pick<PublicEvent, 'title' | 'area_label' | 'starts_at' | 'ends_at'> & {
  state?: string | null;
};

/**
 * Builds the message for the share sheet.
 *
 * @param event - the event's public facts.
 * @param link - the link to add at the end (defaults to SHARE_LINK; a
 *   parameter so tests can check both cases).
 * @returns for example:
 *     Saturday rooftop
 *     Shaw, DC
 *     Sat, Nov 7 · 10 PM – 2 AM
 *     See the vibe on VibeCheck.
 *   The area gets ", DC" added only when the state isn't already in it
 *   (listed areas like "Shaw, DC" already say it). Days and times are New
 *   York time, written as a date (not "Tonight"), because the message may be
 *   read days later.
 */
export function buildShareMessage(event: ShareableEvent, link: string = SHARE_LINK): string {
  const startsAt = new Date(event.starts_at);
  const endsAt = new Date(event.ends_at);
  const area = event.area_label.trim();
  const state = event.state?.trim();
  const place =
    state && !area.toUpperCase().endsWith(`, ${state.toUpperCase()}`) ? `${area}, ${state}` : area;
  const when = `${readableDay(dateInputFor(startsAt))} · ${formatClock(startsAt)} – ${formatClock(endsAt)}`;
  const lines = [event.title.trim(), place, when, 'See the vibe on VibeCheck.'];
  // Only add the link once one exists (see SHARE_LINK).
  if (link.trim() !== '') lines.push(link.trim());
  return lines.join('\n');
}
