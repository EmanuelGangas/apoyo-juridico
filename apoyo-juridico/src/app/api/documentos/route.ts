import { NextResponse } from "next/server";
import prisma from "@/app/lib/prisma";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { r2 } from "@/app/lib/r2";
import crypto from "crypto";

import * as mammoth from "mammoth";
import * as xlsx from "xlsx";

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

const genAI = new GoogleGenerativeAI(process.env.CLAVE_GEMINI_PROD || "");

function obtenerMimeType(ext: string) {
    if (ext === 'pdf') return 'application/pdf';
    if (ext === 'png') return 'image/png';
    if (ext === 'jpeg' || ext === 'jpg') return 'image/jpeg';
    if (ext === 'webp') return 'image/webp';
    return 'text/plain';
}

// NUEVA FUNCIÓN: Formatea cualquier RUT al estándar XX.XXX.XXX-X
function formatearRUT(rut: string) {
    const cleanRut = rut.replace(/[^0-9kK]/g, '').toUpperCase();
    if (cleanRut.length < 2) return cleanRut;
    const body = cleanRut.slice(0, -1);
    const dv = cleanRut.slice(-1);
    const formattedBody = body.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
    return `${formattedBody}-${dv}`;
}

export async function GET() {
    try {
        const documentos = await prisma.documento.findMany({
            include: { caso: { include: { representado: true } } },
            orderBy: { createdAt: 'desc' }
        });
        return NextResponse.json(documentos);
    } catch (error) {
        console.error("Error al obtener documentos globales:", error);
        return NextResponse.json({ error: "Error al obtener documentos" }, { status: 500 });
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const { nombreArchivo, claveArchivo } = body;

        // PASO 1: DESCARGAR ARCHIVO DE R2
        let buffer: Buffer;
        try {
            const comando = new GetObjectCommand({
                Bucket: process.env.R2_BUCKET_NAME,
                Key: claveArchivo,
            });
            const s3Response = await r2.send(comando);
            const byteArray = await s3Response.Body?.transformToByteArray();

            if (!byteArray) throw new Error("El archivo está vacío");
            buffer = Buffer.from(byteArray);
        } catch (err) {
            console.error(`Error al descargar archivo de R2 [${nombreArchivo}]:`, err);
            return NextResponse.json({ error: "No se pudo obtener el archivo físico desde la nube." }, { status: 400 });
        }

        // PASO 2: VALIDACIÓN DE HASH (BLOQUEO DE DUPLICADOS)
        const hashGenerado = crypto.createHash('sha256').update(buffer).digest('hex');

        const documentoDuplicado = await prisma.documento.findUnique({
            where: { hashArchivo: hashGenerado },
            include: { caso: { include: { representado: true } } }
        });

        if (documentoDuplicado) {
            const nombreOriginal = documentoDuplicado.nombreArchivo;
            const clienteAsociado = documentoDuplicado.caso?.representado?.nombre || "Sin Nombre";
            return NextResponse.json({
                error: `⚠️ Documento duplicado: Ya subido como "${nombreOriginal}" en el expediente de ${clienteAsociado}.`
            }, { status: 400 });
        }

        const urlPublica = `https://${process.env.R2_BUCKET_NAME}.${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${claveArchivo}`;

        let errorLectura = false;
        const partesIA: any[] = [];
        const ext = nombreArchivo.split('.').pop()?.toLowerCase() || "";

        // PASO 3: EXTRAER TEXTO O IMÁGENES
        try {
            if (['pdf', 'jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
                partesIA.push({
                    inlineData: { data: buffer.toString("base64"), mimeType: obtenerMimeType(ext) }
                });
            } else if (['docx', 'doc'].includes(ext)) {
                const result = await mammoth.extractRawText({ buffer });
                partesIA.push(`Texto extraído del Word:\n${result.value.substring(0, 15000)}`);
            } else if (['xlsx', 'xls', 'csv'].includes(ext)) {
                const workbook = xlsx.read(buffer, { type: "buffer" });
                const firstSheetName = workbook.SheetNames[0];
                const csvData = xlsx.utils.sheet_to_csv(workbook.Sheets[firstSheetName]);
                partesIA.push(`Datos extraídos del Excel:\n${csvData.substring(0, 15000)}`);
            } else if (ext === 'txt') {
                partesIA.push(`Texto del documento:\n${buffer.toString("utf-8").substring(0, 15000)}`);
            } else {
                throw new Error("Formato no soportado");
            }
        } catch (err) {
            errorLectura = true;
        }

        let materiaLegal = "Documento sin clasificar";
        let resumen = "No se pudo extraer resumen automático.";
        let nombreExtraido = "";
        let rutExtraido = "";

        // PASO 4: ANÁLISIS IA
        if (errorLectura) {
            materiaLegal = "Archivo Ilegible / Dañado";
            resumen = "El documento tiene un formato no soportado, está dañado o protegido.";
        } else {
            try {
                const promptInstrucciones = `
                Eres un asistente legal en Chile.
                1. tipoDocumento: (ej: Demanda, Contrato, Certificado, Resolución). Máximo 4 palabras.
                2. resumen: Resumen ejecutivo (máximo 2 oraciones).
                3. rutRepresentado: RUT completo de la persona/empresa, INCLUYENDO dígito verificador (ej: 12.345.678-9). Si no hay, devuelve "".
                4. nombreRepresentado: Nombre completo de la persona/empresa. Si no hay, devuelve "".
                `;

                const model = genAI.getGenerativeModel({
                    model: "gemini-2.5-flash", // ✅ Modelo actual y soportado
                    generationConfig: {
                        responseMimeType: "application/json",
                        temperature: 0.1
                    }
                });

                const result = await model.generateContent([promptInstrucciones, ...partesIA]);
                const dataIA = JSON.parse(result.response.text());

                materiaLegal = dataIA.tipoDocumento || materiaLegal;
                resumen = dataIA.resumen || resumen;

                nombreExtraido = dataIA.nombreRepresentado ? dataIA.nombreRepresentado.trim() : "";

                // APLICAMOS EL FORMATO ESTRICTO AL RUT EXTRAÍDO POR LA IA
                let rutRaw = dataIA.rutRepresentado ? dataIA.rutRepresentado.trim() : "";
                rutExtraido = rutRaw ? formatearRUT(rutRaw) : "";

            } catch (iaError: any) {
                console.error("Error al clasificar con IA:", iaError);
                materiaLegal = "Error de Análisis IA";
                resumen = (iaError?.status === 503)
                    ? "Los servidores de IA están saturados. Reintenta."
                    : "Hubo un problema procesando el formato con Google Gemini.";
            }
        }

        // PASO 5: CREACIÓN DE EXPEDIENTES Y ASIGNACIÓN
        let casoFinalId = "";
        const rutSeguro = rutExtraido || `S-RUT-${crypto.randomBytes(3).toString('hex')}`;
        const nombreFinal = nombreExtraido || "Sin Nombre";

        try {
            let representado = await prisma.representado.findFirst({
                where: {
                    OR: [
                        ...(rutExtraido ? [{ rut: rutExtraido }] : []),
                        ...(nombreExtraido ? [{ nombre: { equals: nombreExtraido, mode: 'insensitive' as const } }] : [])
                    ]
                },
                include: { casos: true }
            });

            if (representado) {
                if (representado.casos && representado.casos.length > 0) {
                    casoFinalId = representado.casos[0].id;
                } else {
                    const nuevoCaso = await prisma.caso.create({
                        data: { representadoId: representado.id, areaJuridica: "CIVIL" }
                    });
                    casoFinalId = nuevoCaso.id;
                }
            } else {
                const nuevoRepresentado = await prisma.representado.create({
                    data: {
                        nombre: nombreFinal,
                        rut: rutSeguro,
                        casos: { create: { areaJuridica: "CIVIL" } }
                    },
                    include: { casos: true }
                });
                casoFinalId = nuevoRepresentado.casos[0].id;
            }
        } catch (dbError: any) {
            if (dbError.code === 'P2002') {
                const repRescatado = await prisma.representado.findFirst({
                    where: { rut: rutSeguro },
                    include: { casos: true }
                });
                if (repRescatado && repRescatado.casos.length > 0) {
                    casoFinalId = repRescatado.casos[0].id;
                }
            } else {
                throw dbError;
            }
        }

        // PASO 6: GUARDAR EN BASE DE DATOS
        try {
            const nuevoDocumento = await prisma.documento.create({
                data: {
                    casoId: casoFinalId,
                    nombreArchivo: nombreArchivo,
                    urlR2: urlPublica,
                    materiaLegal: materiaLegal,
                    resumen: resumen,
                    hashArchivo: hashGenerado
                }
            });

            return NextResponse.json({ exito: true, documento: nuevoDocumento });

        } catch (errorDb: any) {
            if (errorDb.code === 'P2002' && errorDb.meta?.target?.includes('hashArchivo')) {
                return NextResponse.json({
                    error: `⚠️ Documento duplicado: Un archivo con este mismo contenido ya fue procesado.`
                }, { status: 400 });
            }
            throw errorDb;
        }

    } catch (error) {
        console.error("Error crítico en el endpoint POST:", error);
        return NextResponse.json({ error: "Error interno al registrar el documento." }, { status: 500 });
    }
}

export async function DELETE(request: Request) {
    try {
        const body = await request.json();
        const { id } = body;

        if (!id) {
            return NextResponse.json({ error: "ID de documento no proporcionado." }, { status: 400 });
        }

        const documento = await prisma.documento.findUnique({
            where: { id: id }
        });

        if (!documento) {
            return NextResponse.json({ error: "Documento no encontrado en la base de datos." }, { status: 404 });
        }

        const urlPartes = documento.urlR2.split('.com/');
        const claveArchivo = urlPartes.length > 1 ? urlPartes[1] : null;

        if (claveArchivo) {
            const comandoR2 = new DeleteObjectCommand({
                Bucket: process.env.R2_BUCKET_NAME,
                Key: claveArchivo,
            });
            await r2.send(comandoR2);
        }

        await prisma.documento.delete({
            where: { id: id }
        });

        return NextResponse.json({ exito: true, mensaje: "Documento eliminado permanentemente." });

    } catch (error) {
        console.error("Error al eliminar el documento:", error);
        return NextResponse.json({ error: "Error interno al intentar eliminar el documento." }, { status: 500 });
    }
}