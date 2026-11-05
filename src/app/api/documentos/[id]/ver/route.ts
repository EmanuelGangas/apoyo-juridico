import { NextResponse } from "next/server";
import prisma from "@/app/lib/prisma";
import { GetObjectCommand } from "@aws-sdk/client-s3";
// IMPORTANTE: Importamos el firmador de URL (Si no instalaste la librería, ejecuta: npm install @aws-sdk/s3-request-presigner)
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { r2 } from "@/app/lib/r2";

export const dynamic = 'force-dynamic';

export async function GET(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;

        // 1. Buscar el documento en la base de datos de Prisma
        const documento = await prisma.documento.findUnique({
            where: { id }
        });

        if (!documento || !documento.urlR2) {
            return new NextResponse("El registro del documento no existe en la base de datos.", { status: 404 });
        }

        // 2. Extraer el Key (nombre real del archivo) de la URL pública
        const urlParts = documento.urlR2.split('/');
        const claveArchivo = urlParts[urlParts.length - 1];

        if (!claveArchivo) {
            return new NextResponse("URL del archivo mal formateada.", { status: 400 });
        }

        // 3. Crear el comando de petición a Cloudflare R2 con el tipo de archivo correcto
        const mimeType = obtenerMimeType(documento.nombreArchivo);

        const comando = new GetObjectCommand({
            Bucket: process.env.R2_BUCKET_NAME,
            Key: claveArchivo,
            // Estos Headers obligan al navegador a "mostrar" el archivo en lugar de "descargarlo",
            // y le dicen exactamente si es una foto, un PDF o un Word.
            ResponseContentType: mimeType,
            ResponseContentDisposition: `inline; filename="${documento.nombreArchivo}"`,
        });

        // 4. Generar la URL Firmada Temporal (Ahorra el 100% de RAM del servidor)
        // Esta URL es válida solo por 1 hora (3600 segundos)
        const urlFirmada = await getSignedUrl(r2, comando, { expiresIn: 3600 });

        // 5. Redirigir al usuario al enlace seguro directamente en R2
        return NextResponse.redirect(urlFirmada);

    } catch (error) {
        console.error("Error crítico en el visualizador:", error);
        return new NextResponse("Error interno del servidor.", { status: 500 });
    }
}

// Función auxiliar vital para que el navegador sepa qué está abriendo
function obtenerMimeType(nombre: string) {
    const ext = nombre.split('.').pop()?.toLowerCase();
    if (ext === 'pdf') return 'application/pdf';
    if (ext === 'png') return 'image/png';
    if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
    if (ext === 'webp') return 'image/webp';
    if (ext === 'txt') return 'text/plain';
    if (ext === 'csv') return 'text/csv';
    if (ext === 'doc') return 'application/msword';
    if (ext === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (ext === 'xls') return 'application/vnd.ms-excel';
    if (ext === 'xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

    // Si no lo conoce, fuerza la descarga
    return 'application/octet-stream';
}