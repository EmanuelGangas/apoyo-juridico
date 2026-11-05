import { S3Client } from "@aws-sdk/client-s3";

// Inicializamos el cliente de AWS apuntando a los servidores de Cloudflare R2
export const r2 = new S3Client({
    region: "auto", // Cloudflare R2 siempre usa "auto" como región
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
    },
});