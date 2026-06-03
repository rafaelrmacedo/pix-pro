import { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

const r2Endpoint = process.env.R2_ENDPOINT;
const r2AccessKeyId = process.env.R2_ACCESS_KEY_ID;
const r2SecretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const r2BucketName = process.env.R2_BUCKET_NAME || "pixpro-images";
const r2PublicUrl = process.env.R2_PUBLIC_URL || "https://pub-mock.r2.dev";

// Initialize S3 client for R2
// If credentials are missing, we'll operate in "mock mode" for development
export const isConfigured = !!(r2Endpoint && r2AccessKeyId && r2SecretAccessKey);

const s3Client = isConfigured ? new S3Client({
  region: "auto",
  endpoint: r2Endpoint,
  credentials: {
    accessKeyId: r2AccessKeyId,
    secretAccessKey: r2SecretAccessKey,
  },
}) : null;

/**
 * Uploads a buffer to Cloudflare R2
 * @param {Buffer} buffer The image data
 * @param {string} fileName The name to save as
 * @param {string} contentType MIME type
 * @returns {Promise<string>} The public URL of the uploaded image
 */
export async function uploadToCDN(buffer, fileName, contentType = "image/png") {
  if (!s3Client) {
    console.warn("[Storage] R2 is not configured. Simulating upload for:", fileName);
    // Return a mock URL if R2 is not configured yet
    return `${r2PublicUrl}/${fileName}`;
  }

  try {
    const upload = new Upload({
      client: s3Client,
      params: {
        Bucket: r2BucketName,
        Key: fileName,
        Body: buffer,
        ContentType: contentType,
      },
    });

    await upload.done();
    
    // public URL
    return `${r2PublicUrl}/${fileName}`;
  } catch (error) {
    console.error("[Storage] Failed to upload to R2:", error.message);
    throw error;
  }
}

export default {
  uploadToCDN,
  isConfigured
};
