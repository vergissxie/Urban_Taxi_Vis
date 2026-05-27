import dayjs from 'dayjs';

export function formatDateTime(input: string): string {
  const d = dayjs(input);
  if (!d.isValid()) return input;
  return d.format('YYYY-MM-DD HH:mm:ss');
}
