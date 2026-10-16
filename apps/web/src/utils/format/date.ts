import moment from 'moment';

export const formatDate = (date: Date): string => {
  return moment(date).format('DD/MM/YY');
};

export const formatDateTime = (date: Date): string => {
  return moment(date).format('DD/MM/YY hh:mma');
};

export const formatTime = (date: Date): string => {
  return moment(date).format('HH:mm:ss');
};

export const formatRelativeDate = (date: Date): string => {
  return moment(date).fromNow();
};

export const formatDuration = (durationSecs: number): string => {
  const totalSeconds = Math.max(0, Math.floor(durationSecs));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];

  if (hours > 0) {
    parts.push(`${hours}h`);
  }

  if (minutes > 0) {
    parts.push(`${minutes}m`);
  }

  if (seconds > 0 || parts.length === 0) {
    parts.push(`${seconds}s`);
  }

  return parts.join(' ');
};

/** Reads the local calendar day, not the UTC one. */
export const formatFreshness = (state: 'idle' | 'live' | 'stale', ageSeconds: number | null): string => {
  if (state === 'idle' || ageSeconds === null) {
    return state;
  }

  const age = formatDuration(ageSeconds);

  return state === 'live' ? `live · ${age}` : `stale · ${age} old`;
};
