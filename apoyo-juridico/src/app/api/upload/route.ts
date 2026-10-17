import { NextResponse } from "next/server";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { r2 } from "@/app/lib/r2";
import crypto from "crypto";

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { nombreArchivo, tipoArchivo } = body;

        if (!nombreArchivo || !tipoArchivo) {
            return NextResponse.json(
                { error: "Faltan datos del archivo" },
                { status: 400 }
            );
        }

        // Generamos un ID único para evitar que dos archivos se sobreescriban si se llaman igual
        const idUnico = crypto.randomUUID();
        const nombreSeguro = `${idUnico}-${nombreArchivo.replace(/[^a-zA-Z0-9.-]/g, "_")}`;

        // Preparamos el comando de subida para el bucket
        const comando = new PutObjectCommand({
            Bucket: process.env.R2_BUCKET_NAME,
            Key: nombreSeguro,
            ContentType: tipoArchivo,
        });

        // Generamos la URL prefirmada (expira en 1 hora = 3600 segundos)
        const urlFirmada = await getSignedUrl(r2, comando, { expiresIn: 3600 });

        return NextResponse.json({
            urlDeSubida: urlFirmada,
            claveArchivo: nombreSeguro,
        });

    } catch (error) {
        console.error("Error al generar la URL prefirmada:", error);
        return NextResponse.json(
            { error: "Error interno al procesar la solicitud" },
            { status: 500 }
        );
    }
}