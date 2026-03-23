'use client';

import { useEffect, useState } from 'react';

interface LastUpdatedLabelProps {
  updatedAt?: string | Date | null;
  updatedBy?: string | null;
}

// モジュールレベルキャッシュ: 同一セッション内で1回だけfetch
let userMapCache: Map<string, string> | null = null;
let userMapPromise: Promise<Map<string, string>> | null = null;

async function getUserMap(): Promise<Map<string, string>> {
  if (userMapCache) return userMapCache;
  if (userMapPromise) return userMapPromise;
  userMapPromise = fetch('/api/dispatch/foremen')
    .then(res => res.ok ? res.json() : [])
    .then((users: Array<{ id: string; displayName: string }>) => {
      const map = new Map<string, string>();
      users.forEach(u => map.set(u.id, u.displayName));
      userMapCache = map;
      return map;
    })
    .catch(() => new Map<string, string>());
  return userMapPromise;
}

export default function LastUpdatedLabel({ updatedAt, updatedBy }: LastUpdatedLabelProps) {
  const [updatedByName, setUpdatedByName] = useState<string>('');

  useEffect(() => {
    if (!updatedBy) return;
    getUserMap().then(map => {
      const name = map.get(updatedBy);
      if (name) setUpdatedByName(name);
    });
  }, [updatedBy]);

  if (!updatedAt) return null;

  const formatted = new Date(updatedAt).toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <p className="text-xs text-slate-400">
      最終更新: {formatted}{updatedByName ? ` ${updatedByName}` : ''}
    </p>
  );
}
