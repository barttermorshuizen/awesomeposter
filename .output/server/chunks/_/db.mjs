import { g as getDb$1 } from './client.mjs';
import { g as getEnv } from './env.mjs';

let initialized = false;
function getDb() {
  if (!initialized) {
    getEnv();
    initialized = true;
  }
  return getDb$1();
}

export { getDb as g };
//# sourceMappingURL=db.mjs.map
