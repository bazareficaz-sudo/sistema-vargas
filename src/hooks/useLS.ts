'use client'

import { useState, useEffect } from 'react'

export function useLS<T>(key: string, def: T): [T, (v: T) => void] {
  const [val, setVal] = useState<T>(def)
  useEffect(() => {
    try { const s = localStorage.getItem(key); if (s) setVal(JSON.parse(s)) } catch {}
  }, [key])
  function save(v: T) { setVal(v); try { localStorage.setItem(key, JSON.stringify(v)) } catch {} }
  return [val, save]
}
