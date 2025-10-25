import { vi } from 'vitest';

export function useFakeTime(isoDate = '2024-01-01T00:00:00Z'): void {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(isoDate));
}

export function useRealTime(): void {
  vi.useRealTimers();
}

export function advanceTime(ms: number): void {
  vi.advanceTimersByTime(ms);
}
