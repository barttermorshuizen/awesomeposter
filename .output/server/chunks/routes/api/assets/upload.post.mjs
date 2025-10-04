import { d as defineEventHandler, c as createError, b as readMultipartFormData } from '../../../nitro/nitro.mjs';
import { putAssetObject } from '../../../_/storage.mjs';
import { g as getEnv } from '../../../_/env.mjs';
import { g as getDb, a as assets } from '../../../_/index.mjs';
import 'node:http';
import 'node:https';
import 'node:events';
import 'node:buffer';
import 'node:fs';
import 'node:path';
import 'node:crypto';
import 'node:url';
import '@aws-sdk/client-s3';
import '@aws-sdk/s3-request-presigner';
import 'zod';
import 'node:module';
import 'drizzle-orm/node-postgres';
import 'pg';
import 'drizzle-orm/pg-core';
import 'drizzle-orm';

const upload_post = defineEventHandler(async (event) => {
  var _a, _b, _c;
  console.log("=== ASSET UPLOAD START ===");
  try {
    const env = getEnv();
    console.log("Environment loaded:", {
      hasR2Bucket: !!env.R2_BUCKET_ASSETS,
      hasR2Keys: !!(env.R2_ACCESS_KEY && env.R2_SECRET_KEY),
      hasR2Endpoint: !!env.R2_ENDPOINT,
      endpoint: env.R2_ENDPOINT,
      bucket: env.R2_BUCKET_ASSETS
    });
    if (!env.R2_BUCKET_ASSETS || !env.R2_ACCESS_KEY || !env.R2_SECRET_KEY || !env.R2_ENDPOINT) {
      console.error("R2 configuration missing:", {
        bucket: env.R2_BUCKET_ASSETS,
        hasAccessKey: !!env.R2_ACCESS_KEY,
        hasSecretKey: !!env.R2_SECRET_KEY,
        endpoint: env.R2_ENDPOINT
      });
      throw createError({ statusCode: 500, statusMessage: "Asset storage is not configured." });
    }
    console.log("Reading multipart form data...");
    const formData = await readMultipartFormData(event);
    console.log("Form data received:", {
      hasFormData: !!formData,
      formDataLength: (formData == null ? void 0 : formData.length) || 0,
      formDataKeys: (formData == null ? void 0 : formData.map((f) => f.name)) || []
    });
    if (!formData) {
      throw createError({ statusCode: 400, statusMessage: "No form data received." });
    }
    const file = formData.find((f) => f.name === "file");
    const clientId = (_a = formData.find((f) => f.name === "clientId")) == null ? void 0 : _a.data.toString();
    const briefId = (_b = formData.find((f) => f.name === "briefId")) == null ? void 0 : _b.data.toString();
    console.log("File info:", {
      hasFile: !!file,
      fileName: file == null ? void 0 : file.filename,
      fileSize: (_c = file == null ? void 0 : file.data) == null ? void 0 : _c.length,
      fileType: file == null ? void 0 : file.type,
      clientId
    });
    if (!file || !file.data || !file.filename || !clientId) {
      console.error("Missing required fields:", {
        hasFile: !!file,
        hasData: !!(file == null ? void 0 : file.data),
        hasFilename: !!(file == null ? void 0 : file.filename),
        hasClientId: !!clientId
      });
      throw createError({ statusCode: 400, statusMessage: "File, filename, and clientId are required." });
    }
    const fileExtension = file.filename.split(".").pop();
    const key = briefId ? `briefs/${briefId}/${crypto.randomUUID()}.${fileExtension}` : `clients/${clientId}/${crypto.randomUUID()}.${fileExtension}`;
    console.log("Generated key:", key);
    console.log("Uploading to R2...");
    await putAssetObject(key, file.data, file.type);
    console.log("Upload successful");
    let assetType = "other";
    if (file.type) {
      if (file.type.startsWith("image/")) assetType = "image";
      else if (file.type.startsWith("video/")) assetType = "video";
      else if (file.type.startsWith("audio/")) assetType = "audio";
      else if (file.type.includes("pdf") || file.type.includes("document") || file.type.includes("text") || file.type.includes("spreadsheet")) assetType = "document";
    }
    const db = getDb();
    const assetId = crypto.randomUUID();
    const downloadUrl = `/api/assets/${assetId}/download`;
    await db.insert(assets).values({
      id: assetId,
      clientId,
      briefId: briefId || null,
      filename: key,
      originalName: file.filename,
      url: downloadUrl,
      type: assetType,
      mimeType: file.type || null,
      fileSize: file.data.length,
      metaJson: {}
    });
    console.log("Asset metadata saved to database with ID:", assetId);
    return { ok: true, url: downloadUrl, assetId };
  } catch (error) {
    console.error("Asset upload error:", error);
    throw error;
  } finally {
    console.log("=== ASSET UPLOAD END ===");
  }
});

export { upload_post as default };
//# sourceMappingURL=upload.post.mjs.map
