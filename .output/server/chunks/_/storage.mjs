import { GetObjectCommand, DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { g as getEnv } from './env.mjs';
import { c as createError } from '../nitro/nitro.mjs';
import 'zod';
import 'node:module';
import 'node:http';
import 'node:https';
import 'node:events';
import 'node:buffer';
import 'node:fs';
import 'node:path';
import 'node:crypto';
import 'node:url';

let s3Client = null;
function getS3() {
  if (s3Client) return s3Client;
  const env = getEnv();
  const rawEndpoint = (env.R2_ENDPOINT || "").trim();
  const endpoint = rawEndpoint.startsWith("http") ? rawEndpoint : `https://${rawEndpoint}`;
  try {
    new URL(endpoint);
  } catch {
    throw new Error("Invalid R2_ENDPOINT. Expected full HTTPS URL like https://<ACCOUNT_ID>.r2.cloudflarestorage.com");
  }
  s3Client = new S3Client({
    endpoint,
    region: "auto",
    forcePathStyle: true,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY,
      secretAccessKey: env.R2_SECRET_KEY
    }
  });
  return s3Client;
}
async function putAssetObject(key, body, contentType) {
  console.log("=== STORAGE: putAssetObject START ===");
  console.log("Key:", key);
  console.log("Body type:", typeof body);
  console.log("Body length:", body instanceof Buffer ? body.length : body instanceof Uint8Array ? body.length : body.length);
  console.log("Content type:", contentType);
  try {
    const env = getEnv();
    console.log("Storage env check:", {
      hasBucket: !!env.R2_BUCKET_ASSETS,
      hasKeys: !!(env.R2_ACCESS_KEY && env.R2_SECRET_KEY),
      hasEndpoint: !!env.R2_ENDPOINT,
      bucket: env.R2_BUCKET_ASSETS,
      endpoint: env.R2_ENDPOINT
    });
    if (!env.R2_BUCKET_ASSETS || !env.R2_ACCESS_KEY || !env.R2_SECRET_KEY || !env.R2_ENDPOINT) {
      throw createError({ statusCode: 500, statusMessage: "Asset storage is not configured." });
    }
    const s3 = getS3();
    console.log("S3 client created successfully");
    const command = new PutObjectCommand({
      Bucket: env.R2_BUCKET_ASSETS,
      Key: key,
      Body: body,
      ContentType: contentType || "application/octet-stream"
    });
    console.log("PutObjectCommand created:", {
      bucket: command.input.Bucket,
      key: command.input.Key,
      contentType: command.input.ContentType
    });
    console.log("Sending command to R2...");
    const result = await s3.send(command);
    console.log("R2 upload result:", result);
    const publicUrl = `https://${env.R2_ENDPOINT.replace(/^https?:\/\//, "")}/${env.R2_BUCKET_ASSETS}/${key}`;
    console.log("Generated public URL:", publicUrl);
    return publicUrl;
  } catch (error) {
    console.error("Storage error:", error);
    throw error;
  } finally {
    console.log("=== STORAGE: putAssetObject END ===");
  }
}
async function deleteAssetObject(key) {
  try {
    const env = getEnv();
    if (!env.R2_BUCKET_ASSETS || !env.R2_ACCESS_KEY || !env.R2_SECRET_KEY || !env.R2_ENDPOINT) {
      throw createError({ statusCode: 500, statusMessage: "Asset storage is not configured." });
    }
    const s3 = getS3();
    const deleteCommand = new DeleteObjectCommand({
      Bucket: env.R2_BUCKET_ASSETS,
      Key: key
    });
    await s3.send(deleteCommand);
    console.log(`Deleted asset: ${key}`);
    return true;
  } catch (error) {
    console.error("Error deleting asset:", error);
    throw error;
  }
}
async function getSignedDownloadUrl(key, expiresIn = 3600) {
  try {
    const env = getEnv();
    if (!env.R2_BUCKET_ASSETS || !env.R2_ACCESS_KEY || !env.R2_SECRET_KEY || !env.R2_ENDPOINT) {
      throw createError({ statusCode: 500, statusMessage: "Asset storage is not configured." });
    }
    const s3 = getS3();
    const command = new GetObjectCommand({
      Bucket: env.R2_BUCKET_ASSETS,
      Key: key
    });
    const signedUrl = await getSignedUrl(s3, command, { expiresIn });
    return signedUrl;
  } catch (error) {
    console.error("Error generating signed URL:", error);
    throw error;
  }
}
async function deleteBriefAssets(briefId) {
  try {
    const env = getEnv();
    if (!env.R2_BUCKET_ASSETS || !env.R2_ACCESS_KEY || !env.R2_SECRET_KEY || !env.R2_ENDPOINT) {
      throw createError({ statusCode: 500, statusMessage: "Asset storage is not configured." });
    }
    const s3 = getS3();
    const { ListObjectsV2Command, DeleteObjectsCommand } = await import('@aws-sdk/client-s3');
    const listCommand = new ListObjectsV2Command({
      Bucket: env.R2_BUCKET_ASSETS,
      Prefix: `briefs/${briefId}/`
    });
    const listResult = await s3.send(listCommand);
    if (listResult.Contents && listResult.Contents.length > 0) {
      const deleteCommand = new DeleteObjectsCommand(
        {
          Bucket: env.R2_BUCKET_ASSETS,
          Delete: {
            Objects: listResult.Contents.map((obj) => ({ Key: obj.Key }))
          }
        }
      );
      await s3.send(deleteCommand);
      console.log(`Deleted ${listResult.Contents.length} assets for brief ${briefId}`);
    }
    return true;
  } catch (error) {
    console.error("Error deleting brief assets:", error);
    throw error;
  }
}
async function deleteClientAssets(clientId) {
  try {
    const env = getEnv();
    if (!env.R2_BUCKET_ASSETS || !env.R2_ACCESS_KEY || !env.R2_SECRET_KEY || !env.R2_ENDPOINT) {
      throw createError({ statusCode: 500, statusMessage: "Asset storage is not configured." });
    }
    const s3 = getS3();
    const { ListObjectsV2Command, DeleteObjectsCommand } = await import('@aws-sdk/client-s3');
    const listCommand = new ListObjectsV2Command({
      Bucket: env.R2_BUCKET_ASSETS,
      Prefix: `clients/${clientId}/`
    });
    const listResult = await s3.send(listCommand);
    if (listResult.Contents && listResult.Contents.length > 0) {
      const deleteCommand = new DeleteObjectsCommand(
        {
          Bucket: env.R2_BUCKET_ASSETS,
          Delete: {
            Objects: listResult.Contents.map((obj) => ({ Key: obj.Key }))
          }
        }
      );
      await s3.send(deleteCommand);
      console.log(`Deleted ${listResult.Contents.length} assets for client ${clientId}`);
    }
    if (env.R2_BUCKET_RAW) {
      const rawListCommand = new ListObjectsV2Command({
        Bucket: env.R2_BUCKET_RAW,
        Prefix: `clients/${clientId}/`
      });
      const rawListResult = await s3.send(rawListCommand);
      if (rawListResult.Contents && rawListResult.Contents.length > 0) {
        const rawDeleteCommand = new DeleteObjectsCommand({
          Bucket: env.R2_BUCKET_RAW,
          Delete: {
            Objects: rawListResult.Contents.map((obj) => ({ Key: obj.Key }))
          }
        });
        await s3.send(rawDeleteCommand);
        console.log(`Deleted ${rawListResult.Contents.length} raw files for client ${clientId}`);
      }
    }
    return true;
  } catch (error) {
    console.error("Error deleting client assets:", error);
    throw error;
  }
}

export { deleteAssetObject, deleteBriefAssets, deleteClientAssets, getSignedDownloadUrl, putAssetObject };
//# sourceMappingURL=storage.mjs.map
