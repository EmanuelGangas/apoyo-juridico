import { NextResponse } from "next/server";
import prisma from "@/app/lib/prisma";

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;
        const body = await request.json();
        // Recibimos los nuevos campos de estado y notas
        const { nombreRepresentado, rutRepresentado, areaJuridica, estadoCausa, notas } = body;

        const casoActual = await prisma.caso.findUnique({
            where: { id }
        });

        if (!casoActual || !casoActual.representadoId) {
            return NextResponse.json({ error: "Carpeta no encontrada" }, { status: 404 });
        }

        // 1. Actualizamos el caso
        await prisma.caso.update({
            where: { id },
            data: {
                ...(areaJuridica && { areaJuridica }),
                ...(estadoCausa && { estadoCausa }),
                ...(notas !== undefined && { notas })
            }
        });

        // 2. Actualizamos el perfil del cliente
        const dataToUpdate: any = { nombre: nombreRepresentado };
        if (rutRepresentado && rutRepresentado.trim() !== "") {
            dataToUpdate.rut = rutRepresentado;
        }

        await prisma.representado.update({
            where: { id: casoActual.representadoId },
            data: dataToUpdate
        });

        return NextResponse.json({ exito: true });
    } catch (error: any) {
        if (error.code === 'P2002') {
            return NextResponse.json({ error: "Ese RUT ya está registrado." }, { status: 400 });
        }
        return NextResponse.json({ error: "Error interno" }, { status: 500 });
    }
}

// ... aquí mantienes tu función DELETE tal como la tenías ...

// DELETE: Elimina la carpeta y limpia todos los documentos en su interior
export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;

        // 1. Prisma requiere eliminar primero las dependencias hijas (Documentos)
        // Eliminamos todos los PDFs asociados a esta carpeta
        await prisma.documento.deleteMany({
            where: { casoId: id }
        });

        // 2. Finalmente, eliminamos la carpeta vacía
        await prisma.caso.delete({
            where: { id }
        });

        return NextResponse.json({ exito: true });
    } catch (error) {
        console.error("Error al eliminar caso/carpeta:", error);
        return NextResponse.json({ error: "Error al eliminar" }, { status: 500 });
    }
}