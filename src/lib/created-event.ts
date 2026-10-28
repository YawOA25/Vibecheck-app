/**
 * A one-time note from the New event screen to the home list (VC-63b).
 *
 * Why: the founder reported "when i create an event it doesnt not appesar
 * on the screen". Two things caused it: the event was a hidden test event
 * (fixed on the server), and the home list never reloaded when the admin
 * came back from New event. Now, after a successful create, the New event
 * screen leaves a note here; when the home list comes back into view it
 * takes the note (once), reloads, and tells the admin where to find the
 * event if the current date filter doesn't show it.
 *
 * It is a plain in-memory value, not saved anywhere: if the app restarts,
 * the list loads fresh anyway.
 */

/** What the home list needs to know about the new event. */
export interface CreatedEvent {
  /** The new event's id. */
  id: string;
  /** When it starts (ISO date string), to work out which night it's on. */
  startsAt: string;
}

/** The note waiting to be read, or null. */
let pending: CreatedEvent | null = null;

/**
 * Leaves the note (called by the New event screen after saving).
 *
 * @param event - the new event's id and start time.
 * @returns nothing.
 */
export function noteCreatedEvent(event: CreatedEvent): void {
  pending = event;
}

/**
 * Takes the note, so it is only acted on once.
 *
 * @returns the note, or null when there is none.
 */
export function takeCreatedEvent(): CreatedEvent | null {
  const event = pending;
  pending = null;
  return event;
}
