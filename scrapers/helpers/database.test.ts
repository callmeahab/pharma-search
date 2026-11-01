import { expect, test } from 'bun:test';

for (const exitCode of [0, 1]) {
  test(`worker CSV shutdown releases lingering handles and preserves exit code ${exitCode}`, async () => {
    const script = `
      import { closeDatabase } from ${JSON.stringify(import.meta.dir + '/database.ts')};
      process.exitCode = ${exitCode};
      setInterval(() => {}, 1000);
      await closeDatabase();
    `;
    const child = Bun.spawn(['bun', '-e', script], {
      env: { ...process.env, SCRAPER_EXIT_ON_CLOSE: '1' },
      stdout: 'pipe', stderr: 'pipe',
    });
    const timeout = setTimeout(() => child.kill(), 3000);
    try {
      expect(await child.exited).toBe(exitCode);
      expect(await new Response(child.stdout).text()).toContain('CSV writer closed');
    } finally {
      clearTimeout(timeout);
      child.kill();
    }
  });
}

test('direct CSV callers keep control of the process lifetime', async () => {
  const child = Bun.spawn(['bun', '-e', `
    import { closeDatabase } from ${JSON.stringify(import.meta.dir + '/database.ts')};
    await closeDatabase();
    setTimeout(() => process.exit(7), 30);
  `], {
    env: { ...process.env, SCRAPER_EXIT_ON_CLOSE: '0' },
    stdout: 'pipe', stderr: 'pipe',
  });
  expect(await child.exited).toBe(7);
});
