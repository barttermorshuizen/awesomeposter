import { d as defineEventHandler, r as readBody } from '../../nitro/nitro.mjs';
import 'node:http';
import 'node:https';
import 'node:events';
import 'node:buffer';
import 'node:fs';
import 'node:path';
import 'node:crypto';
import 'node:url';

const index_post = defineEventHandler(async (event) => {
  try {
    const body = await readBody(event);
    const { filename, contentType, fileSize, clientId, briefId } = body;
    const uploadUrl = `https://mock-storage.example.com/upload/${filename}?clientId=${clientId || "none"}&briefId=${briefId || "none"}`;
    return {
      success: true,
      uploadUrl,
      filename
    };
  } catch (error) {
    console.error("Error creating asset upload URL:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error"
    };
  }
});

export { index_post as default };
//# sourceMappingURL=index.post.mjs.map
