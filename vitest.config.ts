import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'src/**/*.test.ts',
      'tests/**/*.test.ts',
      'packages/!(dashboard)/src/**/*.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      // Only measure coverage for modules that have tests (expand as tests are added)
      include: [
        'src/config.ts',
        'src/i18n.ts',
        'src/mount-security.ts',
        'src/db.ts',
        'src/task-scheduler.ts',
        'src/routes/auth.ts',
        'src/routes/groups.ts',
        'src/routes/tasks.ts',
        'src/routes/knowledge.ts',
        'src/routes/config.ts',
        'src/routes/calendar.ts',
        'src/routes/analytics.ts',
        'src/routes/skills.ts',
      ],
      exclude: ['src/index.ts', 'src/test-features.ts'],
      thresholds: { lines: 80, functions: 80, branches: 70 },
    },
  },
});
