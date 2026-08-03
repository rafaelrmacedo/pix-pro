import { S3Client } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";

const r2Endpoint = process.env.R2_ENDPOINT;
const r2AccessKeyId = process.env.R2_ACCESS_KEY_ID;
const r2SecretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
const r2BucketName = process.env.R2_BUCKET_NAME || "pixpro-images";
const r2PublicUrl = process.env.R2_PUBLIC_URL || "https://pub-mock.r2.dev";

export const isConfigured = !!(r2Endpoint && r2AccessKeyId && r2SecretAccessKey);

const s3Client = isConfigured ? new S3Client({
  region: "auto",
  endpoint: r2Endpoint,
  credentials: {
    accessKeyId: r2AccessKeyId,
    secretAccessKey: r2SecretAccessKey,
  },
}) : null;

export async function uploadToCDN(buffer, fileName, contentType = "image/png") {
  if (!s3Client) {
    console.warn("[Storage] R2 is not configured. Simulating upload for:", fileName);
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
