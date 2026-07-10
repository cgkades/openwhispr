import type { CalendarAttendee } from "../types/calendar";

/**
 * Expected total speaker count for a meeting note: the explicit stored value when
 * present, otherwise derived from the calendar participants (non-self attendees + you).
 * Returns null when there's no signal, letting callers fall back to their default.
 */
export const resolveExpectedSpeakerCount = (note?: {
  expected_speaker_count?: number | null;
  participants?: string | null;
}): number | null => {
  if (note?.expected_speaker_count != null) return note.expected_speaker_count;
  if (!note?.participants) return null;

  let attendees: CalendarAttendee[];
  try {
    const parsed = JSON.parse(note.participants);
    attendees = Array.isArray(parsed) ? parsed : [];
  } catch {
    return null;
  }

  const others = attendees.filter((attendee) => attendee?.self !== true).length;
  return others > 0 ? others + 1 : null;
};
