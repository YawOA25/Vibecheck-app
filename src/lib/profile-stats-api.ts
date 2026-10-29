/**
 * Talks to the server for the Me screen's stats row (VC-81): one call,
 * get_my_stats, which answers with YOUR OWN counts only (migration
 * 20261029120000_my_stats.sql). This file only checks and tidies the
 * answer (src/lib/profile-stats.ts).
 */
import { parseStats } from '@/lib/profile-stats';
import type { MyStats } from '@/lib/profile-stats';
import { supabase } from '@/lib/supabase';

/** The answer: your stats, or a failure (the screen then hides the row). */
export type StatsOutcome = { ok: true; stats: MyStats } | { ok: false };

/**
 * Loads your stats.
 *
 * @returns the stats, or { ok: false } on any error or an answer we don't
 *   understand. No message: the stats are a nice extra, so the Me screen
 *   simply leaves the row out instead of showing an error.
 */
export async function getMyStats(): Promise<StatsOutcome> {
  try {
    const { data, error } = await supabase.rpc('get_my_stats', {});
    if (error) return { ok: false };
    const stats = parseStats(data);
    return stats ? { ok: true, stats } : { ok: false };
  } catch {
    // supabase-js normally returns errors, but a dropped connection can throw.
    return { ok: false };
  }
}
