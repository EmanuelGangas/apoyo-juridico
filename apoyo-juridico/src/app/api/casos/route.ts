import { NextResponse } from "next/server";
import prisma from "@/app/lib/prisma";

// ESTAS 3 LÍNEAS SON VITALES PARA QUE SE VEAN LOS CAMBIOS AL INSTANTE
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

export async function GET() {
    try {
        // Obtenemos todos los casos (carpetas) exigiendo que traiga a su dueño y sus archivos
        const casos = await prisma.caso.findMany({
            include: {
                representado: true, // Vital: trae el NOMBRE y RUT del cliente
                documentos: {       // Vital: trae todos los PDFs dentro de la carpeta
                    orderBy: {
                        createdAt: 'desc' // Documentos más nuevos primero
                    }
                }
            },
            orderBy: {
                createdAt: 'desc' // Carpetas más recientes primero
            }
        });

        return NextResponse.json(casos);
    } catch (error) {
        console.error("Error crítico al obtener casos y carpetas:", error);
        return NextResponse.json({ error: "Error de servidor al obtener causas" }, { status: 500 });
    }
}