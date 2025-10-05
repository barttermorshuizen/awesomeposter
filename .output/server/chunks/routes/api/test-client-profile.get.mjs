import { d as defineEventHandler } from '../../nitro/nitro.mjs';
import { i as getPool } from '../../_/client.mjs';
import { g as generateMinimalClientProfile, v as validateClientProfileStructure } from '../../_/sample-client-profile.mjs';
import 'node:http';
import 'node:https';
import 'node:events';
import 'node:buffer';
import 'node:fs';
import 'node:path';
import 'node:crypto';
import 'node:url';
import 'drizzle-orm/node-postgres';
import 'pg';
import 'drizzle-orm/pg-core';
import 'drizzle-orm';

const testClientProfile_get = defineEventHandler(async (event) => {
  try {
    const pool = getPool();
    const { rows } = await pool.query("SELECT * FROM client_profiles LIMIT 5");
    const sampleProfile = generateMinimalClientProfile();
    const validation = validateClientProfileStructure(sampleProfile);
    return {
      ok: true,
      databaseProfiles: rows,
      sampleProfile,
      validation,
      message: "Client profile test completed"
    };
  } catch (error) {
    console.error("Error testing client profiles:", error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Unknown error",
      message: "Failed to test client profiles"
    };
  }
});

export { testClientProfile_get as default };
//# sourceMappingURL=test-client-profile.get.mjs.map
