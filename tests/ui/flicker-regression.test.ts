import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

describe('interaction flicker source guards',()=>{
  const css=readFileSync('src/styles.css','utf8');
  const app=readFileSync('src/App.tsx','utf8');
  test('does not restore repeating loading sheen',()=>{
    expect(css).not.toContain('skeleton-scan');
    expect(css).toMatch(/\.skeleton\s*\{[^}]*animation:\s*none/s);
  });
  test.each(['library-item','station'])('%s does not animate on click',name=>{
    expect(css).toMatch(new RegExp('\\.'+name+'\\s*\\{[^}]*transition:\\s*none','s'));
    expect(css).toMatch(new RegExp('\\.'+name+':active\\s*\\{[^}]*transform:\\s*none','s'));
  });
  test('tracks nested file drags instead of toggling on every child leave',()=>{
    expect(app).toContain('dragDepth.current += 1');
    expect(app).toContain('if (dragDepth.current === 0) setDragging(false)');
    expect(app).toContain('event.dataTransfer.types.includes("Files")');
  });
});
