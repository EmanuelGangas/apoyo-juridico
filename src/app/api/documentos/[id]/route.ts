import { NextResponse } from "next/server";
import prisma from "@/app/lib/prisma";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { r2 } from "@/app/lib/r2";

// PATCH: Actualizar nombre o mover de caso
export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const body = await request.json();
        const { nombreArchivo, casoId, resumen, notas } = body;

        await prisma.documento.update({
            where: { id },
            data: {
                ...(nombreArchivo && { nombreArchivo }),
                ...(casoId && { casoId }),
                ...(resumen !== undefined && { resumen }),
                ...(notas !== undefined && { notas })
            }
        });

        return NextResponse.json({ exito: true });
    } catch (error) {
        console.error("Error al actualizar documento:", error);
        return NextResponse.json({ error: "Error interno" }, { status: 500 });
    }
}

// DELETE: Borrar documento de la BD de forma segura (sin bloquearse si R2 falla)
export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;

        const documento = await prisma.documento.findUnique({ where: { id } });
        if (!documento) {
            return NextResponse.json({ error: "Documento no encontrado" }, { status: 404 });
        }

        // Intentar borrar de R2 de forma opcional (si falla, no interrumpe el borrado en BD)
        try {
            if (documento.urlR2 && documento.urlR2.includes("/")) {
                const urlParts = documento.urlR2.split('/');
                const claveArchivo = urlParts[urlParts.length - 1];

                if (claveArchivo) {
                    const comandoDelete = new DeleteObjectCommand({
                        Bucket: process.env.R2_BUCKET_NAME,
                        Key: claveArchivo,
                    });
                    await r2.send(comandoDelete);
                }
            }
        } catch (r2Error) {
            console.warn("Aviso: El archivo físico no estaba en R2 o hubo un problema al borrarlo:", r2Error);
        }

        // Borrado definitivo en la base de datos Prisma
        await prisma.documento.delete({ where: { id } });

        return NextResponse.json({ exito: true });
    } catch (error) {
        console.error("Error al eliminar documento en BD:", error);
        return NextResponse.json({ error: "Error al eliminar el documento" }, { status: 500 });
    }
}