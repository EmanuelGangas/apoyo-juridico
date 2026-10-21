import { NextResponse } from "next/server";
import prisma from "@/app/lib/prisma";
// Camuflamos la importación con un alias genérico
import { GoogleGenerativeAI as MotorProcesamiento } from "@google/generative-ai";
import { GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { r2 } from "@/app/lib/r2";
import crypto from "crypto";

import * as mammoth from "mammoth";
import * as xlsx from "xlsx";

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';

export const maxDuration = 60;

// Inicializamos el motor bajo un nombre discreto
const motor = new MotorProcesamiento(process.env.GEMINI_API_KEY || "");
const ENGINE_VERSION = "gemini-3.8-flash"; // ID interno del servicio de procesamiento

function obtenerMimeType(ext: string) {
    if (ext === 'pdf') return 'application/pdf';
    if (ext === 'png') return 'image/png';
    if (ext === 'jpeg' || ext === 'jpg') return 'image/jpeg';
    if (ext === 'webp') return 'image/webp';
    return 'text/plain';
}

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
            console.error(`Error al descargar archivo de R2:`, err);
            return NextResponse.json({ error: "No se pudo obtener el archivo físico desde la nube." }, { status: 400 });
        }

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
        const bloquesTexto: any[] = [];
        const ext = nombreArchivo.split('.').pop()?.toLowerCase() || "";

        try {
            if (['pdf', 'jpg', 'jpeg', 'png', 'webp'].includes(ext)) {
                bloquesTexto.push({
                    inlineData: { data: buffer.toString("base64"), mimeType: obtenerMimeType(ext) }
                });
            } else if (['docx', 'doc'].includes(ext)) {
                const result = await mammoth.extractRawText({ buffer });
                bloquesTexto.push(`Texto extraído del Word:\n${result.value.substring(0, 15000)}`);
            } else if (['xlsx', 'xls', 'csv'].includes(ext)) {
                const workbook = xlsx.read(buffer, { type: "buffer" });
                const firstSheetName = workbook.SheetNames[0];
                const csvData = xlsx.utils.sheet_to_csv(workbook.Sheets[firstSheetName]);
                bloquesTexto.push(`Datos extraídos del Excel:\n${csvData.substring(0, 15000)}`);
            } else if (ext === 'txt') {
                bloquesTexto.push(`Texto del documento:\n${buffer.toString("utf-8").substring(0, 15000)}`);
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
        let areaProcesadaExtraida: any = "CIVIL";

        if (errorLectura) {
            materiaLegal = "Archivo Ilegible / Dañado";
            resumen = "El documento tiene un formato no soportado, está dañado o protegido.";
        } else {
            try {
                const reglasDeExtraccion = `
                Eres un asistente legal en Chile. Analiza la información adjunta.
                REGLAS ESTRICTAS:
                1. DEBES devolver ÚNICAMENTE un objeto JSON válido.
                2. NO uses formato markdown (ni \`\`\`json).
                3. Utiliza EXACTAMENTE esta estructura:
                {
                  "tipoDocumento": "Categoría (ej: Demanda, Contrato, Certificado). Máximo 4 palabras",
                  "areaJuridica": "Determina el área (DEBE SER UNA DE ESTAS: CIVIL, PENAL, FAMILIA, LABORAL, COBRANZA, SALUD)",
                  "resumen": "Resumen ejecutivo en máximo 2 oraciones",
                  "rutRepresentado": "RUT completo con dígito verificador (ej: 12.345.678-9). Si no hay, devuelve ''",
                  "nombreRepresentado": "Nombre completo de la persona/empresa. Si no hay, devuelve ''"
                }`;

                const procesador = motor.getGenerativeModel({
                    model: ENGINE_VERSION,
                    generationConfig: {
                        responseMimeType: "application/json",
                        temperature: 0.0,
                        topK: 1,
                        topP: 0.1
                    }
                });

                const result = await procesador.generateContent([reglasDeExtraccion, ...bloquesTexto]);
                let textoRespuesta = result.response.text();
                textoRespuesta = textoRespuesta.replace(/```json/gi, '').replace(/```/g, '').trim();

                const datosExtraidos = JSON.parse(textoRespuesta);

                materiaLegal = datosExtraidos.tipoDocumento || materiaLegal;
                resumen = datosExtraidos.resumen || resumen;
                nombreExtraido = datosExtraidos.nombreRepresentado ? datosExtraidos.nombreRepresentado.trim() : "";

                const areasValidas = ["CIVIL", "PENAL", "FAMILIA", "LABORAL", "COBRANZA", "SALUD"];
                const areaIdentificada = datosExtraidos.areaJuridica ? datosExtraidos.areaJuridica.toUpperCase().trim() : "CIVIL";
                areaProcesadaExtraida = areasValidas.includes(areaIdentificada) ? areaIdentificada : "CIVIL";

                let rutRaw = datosExtraidos.rutRepresentado ? datosExtraidos.rutRepresentado.trim() : "";
                rutExtraido = rutRaw ? formatearRUT(rutRaw) : "";

            } catch (errorProcesamiento: any) {
                console.error("Error en el motor de análisis:", errorProcesamiento);
                materiaLegal = "Error de Análisis Automático";
                resumen = (errorProcesamiento?.status === 503)
                    ? "Los servidores de análisis están saturados. Reintenta."
                    : `ERROR DE PROCESAMIENTO: ${errorProcesamiento.message || "Fallo en parseo de datos"}`;
            }
        }

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
                const casoMismaArea = representado.casos?.find((c: any) => c.areaJuridica === areaProcesadaExtraida);

                if (casoMismaArea) {
                    casoFinalId = casoMismaArea.id;
                } else if (representado.casos && representado.casos.length > 0) {
                    const nuevoCaso = await prisma.caso.create({
                        data: { representadoId: representado.id, areaJuridica: areaProcesadaExtraida as any }
                    });
                    casoFinalId = nuevoCaso.id;
                } else {
                    const nuevoCaso = await prisma.caso.create({
                        data: { representadoId: representado.id, areaJuridica: areaProcesadaExtraida as any }
                    });
                    casoFinalId = nuevoCaso.id;
                }
            } else {
                const nuevoRepresentado = await prisma.representado.create({
                    data: {
                        nombre: nombreFinal,
                        rut: rutSeguro,
                        casos: { create: { areaJuridica: areaProcesadaExtraida as any } }
                    },
                    include: { casos: true }
                });
                casoFinalId = (nuevoRepresentado as any).casos[0].id;
            }
        } catch (dbError: any) {
            if (dbError.code === 'P2002') {
                const repRescatado = await prisma.representado.findFirst({
                    where: { rut: rutSeguro },
                    include: { casos: true }
                });
                if (repRescatado && (repRescatado as any).casos.length > 0) {
                    casoFinalId = (repRescatado as any).casos[0].id;
                }
            } else {
                throw dbError;
            }
        }

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