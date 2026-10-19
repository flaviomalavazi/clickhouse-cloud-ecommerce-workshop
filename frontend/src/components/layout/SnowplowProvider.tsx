'use client';
import { useSnowplow } from '@/hooks/useSnowplow';

export function SnowplowProvider() {
  useSnowplow();
  return null;
}
