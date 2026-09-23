import { defineConfig } from 'vitest/config';

// Pure/unit tests only: no environment loading, migrations or remote database.
export default defineConfig({ test: { include: ['tests/**/*.unit.test.ts', 'tests/warehouseSpatialGeometry.test.ts'], environment: 'node' } });
