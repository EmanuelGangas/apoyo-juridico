"use client";

import { useState, useEffect } from "react";
import {
  FolderOpen, UploadCloud, FileText, CheckCircle, Clock, Trash2, Edit3,
  Folder, Layers, Search, ChevronDown, ChevronUp, Check, Sparkles, AlertTriangle,
  ArrowLeft, Image as ImageIcon, FileSpreadsheet, File, Filter, FileSignature,
  Play, Plus, Loader2, CheckCircle2, XCircle
} from "lucide-react";

type EstadoArchivo = 'esperando' | 'subiendo' | 'analizando' | 'exito' | 'error';
interface ArchivoLote {
  id: string;
  file: globalThis.File;
  estado: EstadoArchivo;
  detalle?: string;
}

export default function Dashboard() {
  const [mounted, setMounted] = useState(false);
  const [ventanaActiva, setVentanaActiva] = useState<"subida" | "subida-masiva" | "documentos" | "causas" | "detalle-carpeta" | "detalle-categoria">("subida");
  const [casos, setCasos] = useState<any[]>([]);
  const [documentosGlobales, setDocumentosGlobales] = useState<any[]>([]);

  // --- SUBIDA INDIVIDUAL ---
  const [archivo, setArchivo] = useState<globalThis.File | null>(null);
  const [estadoSubida, setEstadoSubida] = useState<"esperando" | "subiendo" | "exito" | "error">("esperando");
  const [errorValidacion, setErrorValidacion] = useState<string | null>(null);

  // --- CARGA MASIVA ---
  const [lote, setLote] = useState<ArchivoLote[]>([]);
  const [procesandoLote, setProcesandoLote] = useState(false);

  const [busqueda, setBusqueda] = useState("");
  const [filtroEstado, setFiltroEstado] = useState<string>("TODOS");
  const [resumenesExpandidos, setResumenesExpandidos] = useState<{ [key: string]: boolean }>({});
  const [carpetaSeleccionadaId, setCarpetaSeleccionadaId] = useState<string | null>(null);
  const [categoriaSeleccionada, setCategoriaSeleccionada] = useState<string | null>(null);

  // Estados Edición de Documentos
  const [docEditando, setDocEditando] = useState<any | null>(null);
  const [nuevoNombre, setNuevoNombre] = useState("");
  const [nuevoCasoId, setNuevoCasoId] = useState("");
  const [nuevoResumen, setNuevoResumen] = useState("");
  const [nuevasNotasDoc, setNuevasNotasDoc] = useState("");
  const [docAEliminar, setDocAEliminar] = useState<string | null>(null);

  // Estados Edición de Casos
  const [casoEditando, setCasoEditando] = useState<any | null>(null);
  const [nuevoNombreRepresentado, setNuevoNombreRepresentado] = useState("");
  const [nuevoRutRepresentado, setNuevoRutRepresentado] = useState("");
  const [nuevaAreaJuridica, setNuevaAreaJuridica] = useState("");
  const [nuevoEstadoCausa, setNuevoEstadoCausa] = useState("");
  const [nuevasNotasCaso, setNuevasNotasCaso] = useState("");
  const [casoAEliminar, setCasoAEliminar] = useState<string | null>(null);

  const [notificacion, setNotificacion] = useState<{ tipo: "exito" | "error", mensaje: string } | null>(null);

  const mostrarNotificacion = (tipo: "exito" | "error", mensaje: string) => {
    setNotificacion({ tipo, mensaje });
    setTimeout(() => setNotificacion(null), 4000);
  };
  // Pega esto debajo de mostrarNotificacion (Aprox línea 71)
  const formatearRUT = (valor: string) => {
    const cleanRut = valor.replace(/[^0-9kK]/g, '').toUpperCase();
    if (cleanRut.length < 2) return cleanRut;
    const body = cleanRut.slice(0, -1);
    const dv = cleanRut.slice(-1);
    return `${body.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}-${dv}`;
  };

  const cargarDatos = async () => {
    try {
      const timestamp = new Date().getTime();
      const resCasos = await fetch(`/api/casos?t=${timestamp}`, { cache: "no-store" });
      if (resCasos.ok) setCasos(await resCasos.json());
      const resDocs = await fetch(`/api/documentos?t=${timestamp}`, { cache: "no-store" });
      if (resDocs.ok) setDocumentosGlobales(await resDocs.json());
    } catch (e) {
      console.error("Error cargando datos:", e);
    }
  };

  useEffect(() => {
    setMounted(true);
    cargarDatos();
    const intervalo = setInterval(() => cargarDatos(), 5000);
    return () => clearInterval(intervalo);
  }, []);

  if (!mounted) return null;

  // --- SUBIDA INDIVIDUAL ---
  const manejarSubidaAutonoma = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!archivo) return;
    setEstadoSubida("subiendo");

    try {
      const resTicket = await fetch("/api/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombreArchivo: archivo.name, tipoArchivo: archivo.type }),
      });
      if (!resTicket.ok) throw new Error("Error ticket");
      const { urlDeSubida, claveArchivo } = await resTicket.json();

      const resSubida = await fetch(urlDeSubida, { method: "PUT", body: archivo, headers: { "Content-Type": archivo.type } });
      if (!resSubida.ok) throw new Error("Error subida R2");

      const resBd = await fetch("/api/documentos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombreArchivo: archivo.name, claveArchivo }),
      });

      const dataResBd = await resBd.json();

      if (!resBd.ok) {
        throw new Error(dataResBd.error || "Error al procesar el documento en la base de datos.");
      }

      setEstadoSubida("exito");
      cargarDatos();
      mostrarNotificacion("exito", "Documento procesado y clasificado con IA.");
    } catch (error: any) {
      console.error(error);
      setEstadoSubida("error");
      mostrarNotificacion("error", error.message || "Error al procesar el documento.");
    }
  };

  // --- PROCESAMIENTO MASIVO ---
  const manejarSeleccionArchivosMasivos = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const permitidas = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt', 'jpg', 'jpeg', 'png', 'webp'];
      const nuevosArchivos: ArchivoLote[] = [];

      Array.from(e.target.files).forEach(file => {
        const ext = file.name.split('.').pop()?.toLowerCase();
        if (ext && permitidas.includes(ext)) {
          nuevosArchivos.push({ id: Math.random().toString(36).substring(7), file, estado: 'esperando' });
        } else {
          mostrarNotificacion("error", `El formato de "${file.name}" no está permitido.`);
        }
      });
      setLote(prev => [...prev, ...nuevosArchivos]);
    }
    e.target.value = "";
  };

  const eliminarDelLote = (id: string) => {
    setLote(prev => prev.filter(a => a.id !== id));
  };

  const actualizarEstadoLote = (id: string, estado: EstadoArchivo, detalle?: string) => {
    setLote(prev => prev.map(a => a.id === id ? { ...a, estado, detalle: detalle || a.detalle } : a));
  };

  // ==========================================================
  // CARGA MASIVA - MULTIHILO PROTEGIDO (NUEVO)
  // ==========================================================
  const procesarLote = async () => {
    if (lote.length === 0 || procesandoLote) return;
    setProcesandoLote(true);

    let procesados = 0;
    let conError = 0;

    const pendientes = lote.filter(a => a.estado === 'esperando');
    let index = 0;

    const procesarSiguiente = async () => {
      while (index < pendientes.length) {
        const item = pendientes[index++];
        try {
          actualizarEstadoLote(item.id, 'subiendo');

          const resTicket = await fetch("/api/upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nombreArchivo: item.file.name, tipoArchivo: item.file.type }),
          });
          if (!resTicket.ok) throw new Error("Error al contactar con la nube segura.");
          const { urlDeSubida, claveArchivo } = await resTicket.json();

          const resSubida = await fetch(urlDeSubida, { method: "PUT", body: item.file, headers: { "Content-Type": item.file.type } });
          if (!resSubida.ok) throw new Error("Error subiendo el archivo físico.");

          actualizarEstadoLote(item.id, 'analizando');

          const resBd = await fetch("/api/documentos", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nombreArchivo: item.file.name, claveArchivo }),
          });

          if (!resBd.ok) {
            const errorData = await resBd.json();
            throw new Error(errorData.error || "Fallo en el motor de IA.");
          }

          const dataBd = await resBd.json();
          actualizarEstadoLote(item.id, 'exito', dataBd.documento?.materiaLegal || "Procesado");
          procesados++;

          // Sincroniza al instante para que lo veas en la tabla global
          cargarDatos();

          // Protección Anti-Bloqueo de Google (429)
          await new Promise(resolve => setTimeout(resolve, 3000));

        } catch (error: any) {
          console.error("Error en archivo", item.file.name, error);
          actualizarEstadoLote(item.id, 'error', error.message || "Fallo en el procesamiento");
          conError++;
        }
      }
    };

    // Procesamos de a 3 archivos simultáneamente
    const hilosSimultaneos = Math.min(3, pendientes.length);
    await Promise.all(Array.from({ length: hilosSimultaneos }).map(() => procesarSiguiente()));

    setProcesandoLote(false);
    cargarDatos();

    if (conError === 0) {
      mostrarNotificacion("exito", `¡Procesamiento completado! (${procesados} archivos)`);
    } else {
      mostrarNotificacion("error", `Proceso finalizado. ${procesados} exitosos, ${conError} con error o duplicados.`);
    }
  };

  const limpiarLoteCompletado = () => {
    setLote([]); // Vacía por completo la lista para empezar de nuevo
  };

  const progresoActual = lote.length > 0 ? Math.round((lote.filter(a => a.estado === 'exito' || a.estado === 'error').length / lote.length) * 100) : 0;

  const carpetaActiva = casos.find(c => c.id === carpetaSeleccionadaId);
  const toggleExpandir = (docId: string) => setResumenesExpandidos(prev => ({ ...prev, [docId]: !prev[docId] }));


  // ==========================================================
  // ACTUALIZACIONES OPTIMISTAS (UI INSTANTÁNEA)
  // ==========================================================
  const ejecutarEliminacion = async () => {
    if (!docAEliminar) return;
    const idAEliminar = docAEliminar;

    // Ocultar modal al instante
    setDocAEliminar(null);

    // Borrar de la interfaz visualmente al instante
    setDocumentosGlobales(prev => prev.filter(doc => doc.id !== idAEliminar));
    setCasos(prev => prev.map(c => ({
      ...c, documentos: c.documentos?.filter((d: any) => d.id !== idAEliminar)
    })));

    try {
      const res = await fetch(`/api/documentos/${idAEliminar}`, { method: "DELETE" });
      if (res.ok) {
        mostrarNotificacion("exito", "Documento eliminado.");
        cargarDatos();
      } else { throw new Error(); }
    } catch (error) {
      mostrarNotificacion("error", "Error al eliminar. Revertiendo cambios.");
      cargarDatos();
    }
  };

  const guardarEdicion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!docEditando) return;

    const idEditar = docEditando.id;
    setDocEditando(null); // Ocultar Modal al instante

    // Actualización visual instantánea
    setDocumentosGlobales(prev => prev.map(doc => doc.id === idEditar ? { ...doc, nombreArchivo: nuevoNombre, resumen: nuevoResumen, notas: nuevasNotasDoc } : doc));
    setCasos(prev => prev.map(c => ({
      ...c, documentos: c.documentos?.map((d: any) => d.id === idEditar ? { ...d, nombreArchivo: nuevoNombre, resumen: nuevoResumen, notas: nuevasNotasDoc } : d)
    })));

    try {
      const res = await fetch(`/api/documentos/${idEditar}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombreArchivo: nuevoNombre, casoId: nuevoCasoId, resumen: nuevoResumen, notas: nuevasNotasDoc })
      });
      if (res.ok) {
        mostrarNotificacion("exito", "Documento actualizado al instante.");
        cargarDatos();
      } else { throw new Error(); }
    } catch (error) {
      mostrarNotificacion("error", "Error al guardar los cambios.");
      cargarDatos();
    }
  };

  const guardarEdicionCaso = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!casoEditando) return;

    const idEditar = casoEditando.id;
    setCasoEditando(null); // Ocultar Modal al instante

    // Actualización optimista del expediente en la UI
    setCasos(prev => prev.map(c => c.id === idEditar ? {
      ...c,
      representado: { ...c.representado, nombre: nuevoNombreRepresentado, rut: nuevoRutRepresentado },
      areaJuridica: nuevaAreaJuridica,
      estadoCausa: nuevoEstadoCausa,
      notas: nuevasNotasCaso
    } : c));

    try {
      const res = await fetch(`/api/casos/${idEditar}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombreRepresentado: nuevoNombreRepresentado, rutRepresentado: nuevoRutRepresentado, areaJuridica: nuevaAreaJuridica, estadoCausa: nuevoEstadoCausa, notas: nuevasNotasCaso, representadoId: casoEditando.representado?.id || casoEditando.representadoId })
      });
      if (res.ok) {
        cargarDatos();
        mostrarNotificacion("exito", "Expediente actualizado.");
      } else {
        const dataError = await res.json();
        mostrarNotificacion("error", dataError.error || "Error al actualizar.");
        cargarDatos();
      }
    } catch (error) {
      mostrarNotificacion("error", "Error interno al actualizar expediente.");
      cargarDatos();
    }
  };

  const ejecutarEliminacionCaso = async () => {
    if (!casoAEliminar) return;
    const idAEliminar = casoAEliminar;

    if (carpetaSeleccionadaId === idAEliminar) {
      setVentanaActiva("causas");
      setCarpetaSeleccionadaId(null);
    }

    // Ocultar modal y borrar carpeta visualmente al instante
    setCasoAEliminar(null);
    setCasos(prev => prev.filter(c => c.id !== idAEliminar));

    try {
      const res = await fetch(`/api/casos/${idAEliminar}`, { method: "DELETE" });
      if (res.ok) {
        mostrarNotificacion("exito", "Carpeta eliminada permanentemente.");
        cargarDatos();
      } else { throw new Error(); }
    } catch (error) {
      mostrarNotificacion("error", "Error al intentar borrar la carpeta.");
      cargarDatos();
    }
  };

  const categoriasLegales = ["CIVIL", "PENAL", "FAMILIA", "LABORAL", "COBRANZA", "SALUD"];
  const estadosLegales = ["INGRESADO", "EN_PREPARACION", "EN_REVISION", "EN_TRAMITACION", "SUSPENDIDO", "RESUELTO", "FINALIZADO", "ARCHIVADO"];
  const formatEnumText = (text: string) => text.replace(/_/g, " ");

  const getStatusColor = (status: string) => {
    switch (status) {
      case "INGRESADO": return "bg-sky-50 text-sky-700 border-sky-200";
      case "EN_PREPARACION": return "bg-indigo-50 text-indigo-700 border-indigo-200";
      case "EN_REVISION": return "bg-amber-50 text-amber-700 border-amber-200";
      case "EN_TRAMITACION": return "bg-orange-50 text-orange-700 border-orange-200";
      case "SUSPENDIDO": return "bg-rose-50 text-rose-700 border-rose-200";
      case "RESUELTO": return "bg-teal-50 text-teal-700 border-teal-200";
      case "FINALIZADO": return "bg-emerald-50 text-emerald-700 border-emerald-200";
      case "ARCHIVADO": return "bg-slate-100 text-slate-600 border-slate-300";
      default: return "bg-slate-50 text-slate-700 border-slate-200";
    }
  };

  const getFileIcon = (filename: string, size = 18) => {
    const ext = filename.split('.').pop()?.toLowerCase();
    if (['jpg', 'jpeg', 'png', 'webp'].includes(ext || '')) return <ImageIcon size={size} className="shrink-0" />;
    if (['xls', 'xlsx', 'csv'].includes(ext || '')) return <FileSpreadsheet size={size} className="shrink-0" />;
    if (['doc', 'docx'].includes(ext || '')) return <File size={size} className="shrink-0" />;
    return <FileText size={size} className="shrink-0" />;
  };

  const documentosFiltradosVentana2 = documentosGlobales.filter(doc => doc.nombreArchivo.toLowerCase().includes(busqueda.toLowerCase()) || (doc.resumen || "").toLowerCase().includes(busqueda.toLowerCase()));
  const casosFiltradosTotal = casos.filter(c => {
    const pasaBusqueda = (c.representado?.nombre || "").toLowerCase().includes(busqueda.toLowerCase()) || (c.representado?.rut || "").toLowerCase().includes(busqueda.toLowerCase());
    const pasaFiltro = filtroEstado === "TODOS" || c.estadoCausa === filtroEstado;
    return pasaBusqueda && pasaFiltro;
  });

  return (
    <div className="min-h-screen bg-slate-100/70 flex flex-col lg:flex-row font-sans text-slate-800 antialiased relative">

      {/* BARRA DE NAVEGACIÓN SUPERIOR PARA MÓVILES Y TABLETS */}
      <div className="lg:hidden bg-slate-900 text-white p-4 flex flex-col gap-3 shadow-md z-20">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="bg-gradient-to-tr from-blue-600 to-indigo-600 p-2 rounded-xl"><FolderOpen size={20} /></div>
            <span className="font-extrabold text-base tracking-tight">Apoyo Jurídico</span>
          </div>
          <span className="text-[11px] text-blue-400 font-semibold flex items-center gap-1"><Sparkles size={11} /> Legal AI</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
          <button onClick={() => { setVentanaActiva("subida"); setCarpetaSeleccionadaId(null); setBusqueda(""); }} className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-semibold transition-all ${ventanaActiva === "subida" ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-300"}`}><UploadCloud size={15} /> Individual</button>
          <button onClick={() => { setVentanaActiva("subida-masiva"); setCarpetaSeleccionadaId(null); setBusqueda(""); }} className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-semibold transition-all ${ventanaActiva === "subida-masiva" ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-300"}`}><Layers size={15} /> Carga Masiva</button>
          <button onClick={() => { setVentanaActiva("documentos"); setCarpetaSeleccionadaId(null); setBusqueda(""); }} className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-semibold transition-all ${ventanaActiva === "documentos" ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-300"}`}><FileText size={15} /> Documentos</button>
          <button onClick={() => { setVentanaActiva("causas"); setCarpetaSeleccionadaId(null); setCategoriaSeleccionada(null); setBusqueda(""); }} className={`flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl text-xs font-semibold transition-all ${ventanaActiva === "causas" || ventanaActiva === "detalle-carpeta" || ventanaActiva === "detalle-categoria" ? "bg-blue-600 text-white" : "bg-slate-800 text-slate-300"}`}><Folder size={15} /> Causas</button>
        </div>
      </div>

      {/* PANEL LATERAL DEL DASHBOARD (ESCRITORIO) */}
      <aside className="w-72 bg-slate-900 text-slate-300 p-6 hidden lg:flex flex-col shadow-2xl border-r border-slate-800 shrink-0 relative z-10">
        <div className="flex items-center gap-3.5 mb-10 px-2">
          <div className="bg-gradient-to-tr from-blue-600 to-indigo-600 text-white p-3 rounded-2xl shadow-lg shadow-blue-500/20"><FolderOpen size={24} /></div>
          <div>
            <h1 className="text-lg font-extrabold tracking-tight text-white">Apoyo Jurídico</h1>
            <p className="text-xs text-blue-400 font-medium flex items-center gap-1 mt-0.5"><Sparkles size={12} /> Legal Intelligence AI</p>
          </div>
        </div>
        <nav className="flex-1 space-y-2">
          <button onClick={() => { setVentanaActiva("subida"); setCarpetaSeleccionadaId(null); setBusqueda(""); }} className={`flex items-center justify-start text-left whitespace-nowrap gap-3.5 w-full p-3.5 rounded-2xl font-semibold text-sm transition-all duration-200 ${ventanaActiva === "subida" ? "bg-blue-600 text-white shadow-lg shadow-blue-600/30 translate-x-1" : "hover:bg-slate-800/60 hover:text-white text-slate-400"}`}>
            <UploadCloud size={20} className="shrink-0" /> Subida Autónoma
          </button>
          <button onClick={() => { setVentanaActiva("subida-masiva"); setCarpetaSeleccionadaId(null); setBusqueda(""); }} className={`flex items-center justify-start text-left whitespace-nowrap gap-3.5 w-full p-3.5 rounded-2xl font-semibold text-sm transition-all duration-200 ${ventanaActiva === "subida-masiva" ? "bg-blue-600 text-white shadow-lg shadow-blue-600/30 translate-x-1" : "hover:bg-slate-800/60 hover:text-white text-slate-400"}`}>
            <Layers size={20} className="shrink-0" /> Carga Masiva IA
          </button>
          <button onClick={() => { setVentanaActiva("documentos"); setCarpetaSeleccionadaId(null); setBusqueda(""); }} className={`flex items-center justify-start text-left whitespace-nowrap gap-3.5 w-full p-3.5 rounded-2xl font-semibold text-sm transition-all duration-200 ${ventanaActiva === "documentos" ? "bg-blue-600 text-white shadow-lg shadow-blue-600/30 translate-x-1" : "hover:bg-slate-800/60 hover:text-white text-slate-400"}`}>
            <FileText size={20} className="shrink-0" /> Gestión Global
          </button>
          <button onClick={() => { setVentanaActiva("causas"); setCarpetaSeleccionadaId(null); setCategoriaSeleccionada(null); setBusqueda(""); }} className={`flex items-center justify-start text-left whitespace-nowrap gap-3.5 w-full p-3.5 rounded-2xl font-semibold text-sm transition-all duration-200 ${ventanaActiva === "causas" || ventanaActiva === "detalle-carpeta" || ventanaActiva === "detalle-categoria" ? "bg-blue-600 text-white shadow-lg shadow-blue-600/30 translate-x-1" : "hover:bg-slate-800/60 hover:text-white text-slate-400"}`}>
            <Folder size={20} className="shrink-0" /> Causas y Representados
          </button>
        </nav>
      </aside>

      <main className="flex-1 p-4 sm:p-6 md:p-10 overflow-y-auto relative z-0 min-w-0">

        {/* -------------------- 1. VENTANA PRINCIPAL: SUBIDA INDIVIDUAL -------------------- */}
        {ventanaActiva === "subida" && (
          <div className="max-w-2xl mx-auto py-4 md:py-6 animate-fadeIn">
            <header className="mb-8 text-center">
              <span className="bg-blue-100 text-blue-700 text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider">Ingreso Inteligente</span>
              <h2 className="text-3xl md:text-4xl font-extrabold text-slate-900 mt-3 tracking-tight">Carga de Documentos</h2>
              <p className="text-slate-500 mt-2 text-sm md:text-base">Carga un documento legal para clasificación y análisis inmediato.</p>
            </header>

            <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xl shadow-slate-200/50 p-6 sm:p-8 md:p-10 backdrop-blur-xl">
              <form onSubmit={manejarSubidaAutonoma} className="space-y-6">
                <div className={`border-2 border-dashed rounded-3xl p-8 sm:p-10 text-center transition-all cursor-pointer relative group ${errorValidacion ? "border-rose-300 bg-rose-50" : "border-blue-200 bg-gradient-to-b from-blue-50/50 to-indigo-50/30 hover:border-blue-400"}`}>
                  <input
                    type="file"
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.jpg,.jpeg,.png,.webp"
                    className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
                    onChange={(e) => {
                      setErrorValidacion(null);
                      if (e.target.files && e.target.files.length > 0) {
                        const file = e.target.files[0];
                        const ext = file.name.split('.').pop()?.toLowerCase();
                        const permitidas = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt', 'jpg', 'jpeg', 'png', 'webp'];
                        if (!ext || !permitidas.includes(ext)) {
                          setErrorValidacion(`Formato .${ext} no permitido.`);
                          setArchivo(null);
                          return;
                        }
                        setArchivo(file);
                        setEstadoSubida("esperando");
                      }
                    }}
                  />
                  {archivo ? (
                    <div className="flex flex-col items-center gap-3">
                      <div className="bg-blue-600 text-white p-4 rounded-2xl shadow-md">
                        {getFileIcon(archivo.name, 32)}
                      </div>
                      <span className="text-slate-900 font-bold text-base sm:text-lg truncate max-w-full px-4">{archivo.name}</span>
                    </div>
                  ) : (
                    <div className="text-slate-500 py-4 space-y-3">
                      <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto transition-transform ${errorValidacion ? "bg-rose-100 text-rose-600" : "bg-blue-100 text-blue-600 group-hover:scale-110"}`}><UploadCloud size={30} /></div>
                      <div className="text-sm sm:text-base"><span className={`font-bold ${errorValidacion ? "text-rose-600" : "text-blue-600"}`}>Haz clic para explorar</span> o arrastra tu archivo</div>
                      <p className="text-xs text-slate-400 font-medium mt-2">Soporta PDF, Word, Excel, Texto e Imágenes</p>
                    </div>
                  )}
                </div>
                {errorValidacion && <div className="flex items-center gap-2 text-rose-600 text-sm font-semibold px-2"><AlertTriangle size={18} /> {errorValidacion}</div>}
                <div className="flex flex-col sm:flex-row gap-3 pt-2">
                  <button type="submit" disabled={archivo === null} className={`flex-1 py-4 px-6 rounded-2xl text-sm sm:text-base font-bold transition-all shadow-lg ${archivo === null ? "bg-slate-200 text-slate-400 cursor-not-allowed shadow-none" : "bg-blue-600 hover:bg-blue-700 text-white shadow-blue-600/30"}`}>Analizar y Organizar Automáticamente</button>
                  {archivo !== null && <button type="button" onClick={() => { setArchivo(null); setEstadoSubida("esperando"); setErrorValidacion(null); }} className="px-6 py-4 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-2xl text-sm sm:text-base font-semibold transition-colors">Cancelar</button>}
                </div>
              </form>
            </div>
          </div>
        )}

        {/* -------------------- 2. VENTANA DEDICADA: CARGA MASIVA -------------------- */}
        {ventanaActiva === "subida-masiva" && (
          <div className="max-w-4xl mx-auto py-4 md:py-6 animate-fadeIn">
            <header className="mb-8 text-center">
              <span className="bg-indigo-100 text-indigo-700 text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider flex items-center justify-center w-max mx-auto gap-2"><Sparkles size={14} /> Ingreso Inteligente</span>
              <h2 className="text-3xl md:text-4xl font-extrabold text-slate-900 mt-3 tracking-tight">Carga Masiva de Documentos</h2>
              <p className="text-slate-500 mt-2 text-sm md:text-base font-medium max-w-xl mx-auto">Sube 2 o más documentos de cualquier cliente. El motor de IA clasificará cada uno, asociándolo a su causa o creando un nuevo expediente.</p>
            </header>

            <div className="bg-white rounded-3xl border border-slate-200/80 shadow-xl shadow-slate-200/50 overflow-hidden backdrop-blur-xl">
              <div className={`transition-all p-6 sm:p-8 ${lote.length > 0 ? "bg-slate-50 border-b border-slate-200" : "p-8 sm:p-12"}`}>
                <div className={`border-2 border-dashed rounded-3xl text-center transition-all cursor-pointer relative group ${procesandoLote ? "opacity-50 pointer-events-none" : ""} ${lote.length > 0 ? "border-slate-300 bg-white hover:border-blue-400 p-6" : "border-indigo-200 bg-gradient-to-b from-indigo-50/40 to-blue-50/30 hover:border-indigo-400 p-10 sm:p-16"}`}>
                  <input type="file" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.jpg,.jpeg,.png,.webp" className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" onChange={manejarSeleccionArchivosMasivos} disabled={procesandoLote} />
                  {lote.length > 0 ? (
                    <div className="flex items-center justify-center gap-3 text-slate-600 text-sm sm:text-base font-bold group-hover:text-blue-600 transition-colors">
                      <Plus size={22} /> Agregar más archivos a la cola
                    </div>
                  ) : (
                    <div className="text-slate-500 space-y-4 pointer-events-none">
                      <div className="w-16 h-16 sm:w-20 sm:h-20 bg-indigo-100 text-indigo-600 rounded-3xl flex items-center justify-center mx-auto transition-transform group-hover:scale-110 shadow-inner">
                        <Layers size={34} />
                      </div>
                      <div className="text-base sm:text-lg">
                        <span className="font-extrabold text-indigo-600">Selecciona o arrastra</span>
                        <span> múltiples documentos aquí</span>
                      </div>
                      <p className="text-xs sm:text-sm text-slate-400 font-medium">Soporta PDF, Word, Excel e Imágenes sin límite de archivos.</p>
                    </div>
                  )}
                </div>
              </div>

              {lote.length > 0 && (
                <div className="bg-white">
                  <div className="px-6 sm:px-8 pt-6 pb-2">
                    <div className="flex justify-between items-end mb-2">
                      <span className="text-xs sm:text-sm font-bold text-slate-600 uppercase">Progreso General del Lote</span>
                      <span className="text-xl sm:text-2xl font-extrabold text-indigo-600">{progresoActual}%</span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-3 overflow-hidden shadow-inner">
                      <div className="bg-gradient-to-r from-blue-500 to-indigo-600 h-3 rounded-full transition-all duration-500 ease-out" style={{ width: `${progresoActual}%` }}></div>
                    </div>
                  </div>

                  <div className="p-6 sm:p-8">
                    <div className="max-h-[35vh] overflow-y-auto pr-2 space-y-3">
                      {lote.map((item) => (
                        <div key={item.id} className={`flex items-center gap-3.5 p-3.5 sm:p-4 rounded-2xl border transition-colors ${item.estado === 'esperando' ? "bg-slate-50 border-slate-200" : item.estado === 'subiendo' || item.estado === 'analizando' ? "bg-blue-50/50 border-blue-200 shadow-sm" : item.estado === 'exito' ? "bg-emerald-50/50 border-emerald-200" : "bg-rose-50/50 border-rose-200"}`}>
                          <div className={`p-2.5 sm:p-3 rounded-xl shrink-0 ${item.estado === 'esperando' ? "bg-white text-slate-500 shadow-sm" : item.estado === 'exito' ? "bg-emerald-100 text-emerald-600" : item.estado === 'error' ? "bg-rose-100 text-rose-600" : "bg-blue-600 text-white shadow-md"}`}>
                            {item.estado === 'subiendo' || item.estado === 'analizando' ? <Loader2 size={20} className="animate-spin" /> : item.estado === 'exito' ? <CheckCircle2 size={20} /> : item.estado === 'error' ? <XCircle size={20} /> : getFileIcon(item.file.name, 20)}
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4 className="font-bold text-slate-800 text-sm truncate">{item.file.name}</h4>
                            <div className="flex items-center gap-2 mt-1">
                              {item.estado === 'esperando' && <span className="text-xs font-semibold text-slate-400">En cola</span>}
                              {item.estado === 'subiendo' && <span className="text-xs font-semibold text-blue-600">Subiendo a Cloudflare R2...</span>}
                              {item.estado === 'analizando' && <span className="text-xs font-semibold text-indigo-600 flex items-center gap-1"><Sparkles size={12} /> Analizando con IA...</span>}
                              {item.estado === 'exito' && <span className="inline-flex items-center text-xs font-semibold text-emerald-700 bg-emerald-100/80 px-2.5 py-0.5 rounded-lg">Clasificado: {item.detalle}</span>}
                              {item.estado === 'error' && <span className="text-xs font-semibold text-rose-600">{item.detalle}</span>}
                            </div>
                          </div>
                          {item.estado === 'esperando' && !procesandoLote && (
                            <button onClick={() => eliminarDelLote(item.id)} className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors shrink-0"><Trash2 size={18} /></button>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="p-6 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row gap-4 items-center justify-between rounded-b-3xl">
                    <div className="text-sm font-semibold text-slate-500">
                      Total: <span className="text-slate-900 font-bold">{lote.length}</span> documentos seleccionados.
                    </div>
                    <div className="flex gap-3 w-full sm:w-auto">
                      {lote.every(a => a.estado === 'exito' || a.estado === 'error') ? (
                        <button onClick={limpiarLoteCompletado} className="flex-1 sm:flex-none px-6 py-3 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-sm font-bold transition-all">Limpiar Lista</button>
                      ) : (
                        <>
                          <button onClick={() => setLote([])} disabled={procesandoLote} className="flex-1 sm:flex-none px-5 py-3 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-sm font-bold transition-all disabled:opacity-50">Cancelar Todo</button>
                          <button onClick={procesarLote} disabled={procesandoLote} className="flex-1 sm:flex-none px-7 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-bold transition-all shadow-lg shadow-blue-600/30 disabled:opacity-50 flex items-center justify-center gap-2">
                            {procesandoLote ? <><Loader2 size={16} className="animate-spin" /> Procesando Lote...</> : <><Play size={16} fill="currentColor" /> Procesar Todos</>}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* -------------------- 3. GESTIÓN GLOBAL DE DOCUMENTOS (TABLA CORREGIDA Y RESPONSIVA) -------------------- */}
        {ventanaActiva === "documentos" && (
          <div className="max-w-7xl mx-auto py-2 animate-fadeIn">
            <header className="mb-6 md:mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div>
                <h2 className="text-2xl md:text-3xl font-extrabold text-slate-900 tracking-tight">Gestión Global de Documentos</h2>
                <p className="text-xs md:text-sm text-slate-500 font-medium mt-1">Todos los archivos analizados en la plataforma</p>
              </div>
              <div className="relative w-full md:w-80 lg:w-96">
                <Search className="absolute left-4 top-3.5 text-slate-400" size={18} />
                <input type="text" placeholder="Buscar por nombre o resumen..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} className="w-full bg-white border border-slate-200 rounded-2xl pl-11 pr-4 py-3 text-sm text-slate-700 shadow-sm outline-none focus:ring-2 focus:ring-blue-500/20" />
              </div>
            </header>

            <div className="bg-white rounded-3xl border border-slate-200/85 shadow-xl shadow-slate-200/50 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[780px] text-left border-collapse table-fixed">
                  <thead>
                    <tr className="bg-slate-50/90 border-b border-slate-200 text-slate-500 text-[11px] font-bold uppercase tracking-wider">
                      <th className="py-4 px-6 w-[43%]">Documento & Notas</th>
                      <th className="py-4 px-5 w-[24%]">Representado / Causa</th>
                      <th className="py-4 px-5 w-[21%]">Clasificación IA</th>
                      <th className="py-4 px-6 w-[12%] text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {documentosFiltradosVentana2.map((doc) => (
                      <tr key={doc.id} className="hover:bg-slate-50/70 transition-colors group">
                        {/* COLUMNA 1: DOCUMENTO Y RESUMEN */}
                        <td className="py-4 px-6 align-top">
                          <a href={`/api/documentos/${doc.id}/ver`} target="_blank" rel="noopener noreferrer" className="font-bold text-slate-900 hover:text-blue-600 flex items-center gap-3 transition-colors">
                            <div className="p-2 bg-blue-50 text-blue-600 rounded-xl group-hover:bg-blue-600 group-hover:text-white transition-colors shrink-0">
                              {getFileIcon(doc.nombreArchivo, 18)}
                            </div>
                            <span className="truncate text-sm font-bold">{doc.nombreArchivo}</span>
                          </a>
                          <div className="pl-11 mt-1.5 pr-2">
                            <p className={`text-xs text-slate-500 leading-relaxed transition-all duration-300 ${resumenesExpandidos[doc.id] ? "whitespace-pre-wrap" : "line-clamp-1"}`}>
                              <span className="font-semibold text-slate-700">Resumen:</span> {doc.resumen}
                            </p>
                            {doc.notas && (
                              <p className="text-xs text-amber-800 bg-amber-50/80 px-2.5 py-1.5 rounded-lg mt-2 border border-amber-200/70 leading-relaxed">
                                <span className="font-bold">Notas:</span> {doc.notas}
                              </p>
                            )}
                            <button onClick={() => toggleExpandir(doc.id)} className="text-[11px] font-bold text-blue-600 hover:text-blue-800 mt-1.5 inline-flex items-center gap-1 transition-colors">
                              {resumenesExpandidos[doc.id] ? <><ChevronUp size={13} /> Minimizar</> : <><ChevronDown size={13} /> Leer completo</>}
                            </button>
                          </div>
                        </td>

                        {/* COLUMNA 2: REPRESENTADO / CAUSA */}
                        <td className="py-4 px-5 align-middle">
                          <span className="font-semibold text-slate-800 text-sm leading-snug block break-words">
                            {doc.caso?.representado?.nombre || "Sin Nombre"}
                          </span>
                          {doc.caso?.representado?.rut && (
                            <span className="text-xs text-slate-400 font-medium mt-0.5 block">
                              RUT: {doc.caso.representado.rut}
                            </span>
                          )}
                        </td>

                        {/* COLUMNA 3: CLASIFICACIÓN IA */}
                        <td className="py-4 px-5 align-middle">
                          <span className="inline-flex items-center justify-center text-center text-xs font-semibold px-3 py-1.5 rounded-xl border bg-indigo-50/90 text-indigo-700 border-indigo-200/70 leading-tight max-w-full">
                            {doc.materiaLegal || "Documento"}
                          </span>
                        </td>

                        {/* COLUMNA 4: ACCIONES */}
                        <td className="py-4 px-6 align-middle text-right whitespace-nowrap">
                          <div className="inline-flex items-center justify-end gap-1">
                            <button
                              onClick={() => { setDocEditando(doc); setNuevoNombre(doc.nombreArchivo); setNuevoCasoId(doc.casoId); setNuevoResumen(doc.resumen || ""); setNuevasNotasDoc(doc.notas || ""); }}
                              className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all"
                              title="Editar"
                            >
                              <Edit3 size={17} />
                            </button>
                            <button
                              onClick={() => setDocAEliminar(doc.id)}
                              className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all"
                              title="Eliminar"
                            >
                              <Trash2 size={17} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* -------------------- 4. CAUSAS Y REPRESENTADOS -------------------- */}
        {ventanaActiva === "causas" && (
          <div className="max-w-7xl mx-auto py-2 animate-fadeIn">
            <header className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div><h2 className="text-2xl md:text-3xl font-extrabold text-slate-900 tracking-tight">Causas y Carpetas</h2></div>
              <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
                <div className="relative flex-1 sm:w-60"><Filter className="absolute left-4 top-3.5 text-slate-400" size={16} /><select value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)} className="w-full bg-white border border-slate-200 rounded-2xl pl-11 pr-4 py-3 text-sm text-slate-700 shadow-sm outline-none focus:ring-2 focus:ring-blue-500/20 font-semibold appearance-none"><option value="TODOS">Todos los Estados</option>{estadosLegales.map(est => <option key={est} value={est}>{formatEnumText(est)}</option>)}</select></div>
                <div className="relative flex-1 sm:w-72"><Search className="absolute left-4 top-3.5 text-slate-400" size={18} /><input type="text" placeholder="Buscar expediente o RUT..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} className="w-full bg-white border border-slate-200 rounded-2xl pl-11 pr-4 py-3 text-sm text-slate-700 shadow-sm outline-none focus:ring-2 focus:ring-blue-500/20" /></div>
              </div>
            </header>

            <div className="space-y-8">
              {categoriasLegales.map((categoria) => {
                const casosDeCategoria = casosFiltradosTotal.filter(c => (c.areaJuridica || "").toUpperCase() === categoria.toUpperCase());
                const casosAMostrar = casosDeCategoria.slice(0, 6);

                return (
                  <div key={categoria} className="bg-white rounded-3xl border border-slate-200/85 p-5 sm:p-7 shadow-xl shadow-slate-200/40">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 pb-5 border-b border-slate-100">
                      <div className="flex items-center gap-3.5">
                        <div className={`p-3 rounded-2xl ${casosDeCategoria.length > 0 ? 'bg-blue-600 text-white' : 'bg-slate-200 text-slate-400'}`}><Folder size={20} /></div>
                        <h3 className={`text-lg sm:text-xl font-extrabold uppercase tracking-tight ${casosDeCategoria.length > 0 ? 'text-slate-900' : 'text-slate-400'}`}>{categoria}</h3>
                        <div className="bg-slate-100 text-slate-600 text-xs font-bold px-3 py-1 rounded-full">{casosDeCategoria.length} {casosDeCategoria.length === 1 ? 'Carpeta' : 'Carpetas'}</div>
                      </div>
                      {casosDeCategoria.length > 6 && (<button onClick={() => { setCategoriaSeleccionada(categoria); setVentanaActiva("detalle-categoria"); }} className="text-xs sm:text-sm font-bold text-blue-600 bg-blue-50 hover:bg-blue-600 hover:text-white px-4 py-2.5 rounded-xl transition-colors shadow-sm inline-flex items-center justify-center gap-2">Ver todas las carpetas <ArrowLeft size={15} className="rotate-180" /></button>)}
                    </div>
                    {casosDeCategoria.length === 0 ? (
                      <div className="text-center py-10 bg-slate-50/50 border-2 border-dashed border-slate-200 rounded-2xl"><FolderOpen size={36} className="mx-auto text-slate-300 mb-2.5" /><p className="text-xs sm:text-sm font-semibold text-slate-400">Aún no hay carpetas registradas en esta área legal.</p></div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                        {casosAMostrar.map((caso) => (
                          <div key={caso.id} onClick={() => { setCarpetaSeleccionadaId(caso.id); setVentanaActiva("detalle-carpeta"); setBusqueda(""); }} className="bg-slate-50/80 rounded-2xl border border-slate-200/80 p-5 hover:border-blue-300 hover:shadow-lg transition-all cursor-pointer flex flex-col justify-between group relative overflow-hidden">
                            <div className="flex items-start justify-between mb-4">
                              <div className="flex gap-3 min-w-0">
                                <div className="text-blue-500 group-hover:scale-110 transition-transform shrink-0 mt-0.5"><Folder size={26} fill="currentColor" fillOpacity={0.2} /></div>
                                <div className="min-w-0">
                                  <h4 className="font-bold text-slate-900 text-sm sm:text-base truncate">{caso.representado?.nombre || "Sin Nombre"}</h4>
                                  <p className="text-xs text-slate-500 font-medium mt-0.5">RUT: {caso.representado?.rut || "N/A"}</p>
                                </div>
                              </div>
                            </div>
                            {caso.notas && (<div className="mb-4 text-xs text-slate-600 bg-slate-100/70 p-2.5 rounded-xl border border-slate-200/60 line-clamp-2"><span className="font-bold mr-1">Nota:</span>{caso.notas}</div>)}
                            <div className="mt-auto pt-3.5 border-t border-slate-200/80 flex items-center justify-between gap-2 text-xs font-bold text-slate-600">
                              <span className={`inline-flex items-center px-2.5 py-1 rounded-lg border text-[11px] font-bold ${getStatusColor(caso.estadoCausa || "INGRESADO")}`}>{formatEnumText(caso.estadoCausa || "INGRESADO")}</span>
                              <span className="bg-white border border-slate-200 px-3 py-1 rounded-full shadow-sm whitespace-nowrap text-xs">{caso.documentos?.length || 0} docs</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* -------------------- 5. DETALLE DE CATEGORÍA (VER TODAS) -------------------- */}
        {ventanaActiva === "detalle-categoria" && categoriaSeleccionada && (
          <div className="max-w-7xl mx-auto py-2 animate-fadeIn">
            <button onClick={() => setVentanaActiva("causas")} className="inline-flex items-center gap-2 text-xs sm:text-sm font-bold text-slate-600 hover:text-blue-600 mb-6 bg-white px-4 py-2.5 rounded-xl border border-slate-200 shadow-sm transition-colors"><ArrowLeft size={16} /> Volver a Causas</button>
            <header className="mb-8 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 bg-white p-6 rounded-3xl border border-slate-200/85 shadow-xl shadow-slate-200/40">
              <div className="flex items-center gap-4"><div className="bg-blue-600 text-white p-3.5 rounded-2xl shadow-md"><FolderOpen size={28} /></div><div><h2 className="text-2xl md:text-3xl font-extrabold text-slate-900 tracking-tight uppercase">ÁREA {categoriaSeleccionada}</h2><p className="text-slate-500 text-xs sm:text-sm font-medium">Todas las carpetas registradas en esta materia</p></div></div>
              <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto"><div className="relative flex-1 sm:w-56"><Filter className="absolute left-4 top-3.5 text-slate-400" size={16} /><select value={filtroEstado} onChange={(e) => setFiltroEstado(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-11 pr-4 py-3 text-sm text-slate-700 font-semibold outline-none appearance-none"><option value="TODOS">Todos los Estados</option>{estadosLegales.map(est => <option key={est} value={est}>{formatEnumText(est)}</option>)}</select></div><div className="relative flex-1 sm:w-72"><Search className="absolute left-4 top-3.5 text-slate-400" size={18} /><input type="text" placeholder="Buscar expediente..." value={busqueda} onChange={(e) => setBusqueda(e.target.value)} className="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-11 pr-4 py-3 text-sm text-slate-700 outline-none" /></div></div>
            </header>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
              {casosFiltradosTotal.filter(c => (c.areaJuridica || "").toUpperCase() === categoriaSeleccionada.toUpperCase()).map((caso) => (
                <div key={caso.id} onClick={() => { setCarpetaSeleccionadaId(caso.id); setVentanaActiva("detalle-carpeta"); setBusqueda(""); }} className="bg-white rounded-2xl border border-slate-200/80 p-5 hover:border-blue-400 hover:shadow-xl shadow-slate-200 transition-all cursor-pointer flex flex-col justify-between group relative overflow-hidden">
                  <div className="flex items-start justify-between mb-4"><div className="flex gap-3 min-w-0"><div className="text-blue-500 group-hover:scale-110 transition-transform shrink-0 mt-0.5"><Folder size={26} fill="currentColor" fillOpacity={0.2} /></div><div className="min-w-0"><h4 className="font-bold text-slate-900 text-sm sm:text-base truncate">{caso.representado?.nombre || "Sin Nombre"}</h4><p className="text-xs text-slate-500 font-medium mt-0.5">RUT: {caso.representado?.rut || "N/A"}</p></div></div></div>
                  {caso.notas && (<div className="mb-4 text-xs text-slate-600 bg-slate-50 p-2.5 rounded-xl border border-slate-200/60 line-clamp-2"><span className="font-bold mr-1">Nota:</span>{caso.notas}</div>)}
                  <div className="mt-auto pt-3.5 border-t border-slate-100 flex items-center justify-between gap-2 text-xs font-bold text-slate-600"><span className={`inline-flex items-center px-2.5 py-1 rounded-lg border text-[11px] font-bold ${getStatusColor(caso.estadoCausa || "INGRESADO")}`}>{formatEnumText(caso.estadoCausa || "INGRESADO")}</span><span className="bg-slate-50 border border-slate-200 px-3 py-1 rounded-full shadow-sm whitespace-nowrap">{caso.documentos?.length || 0} docs</span></div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* -------------------- 6. DETALLE DE CARPETA -------------------- */}
        {ventanaActiva === "detalle-carpeta" && carpetaActiva && (
          <div className="max-w-7xl mx-auto py-2 animate-fadeIn">
            <button onClick={() => setVentanaActiva(categoriaSeleccionada ? "detalle-categoria" : "causas")} className="inline-flex items-center gap-2 text-xs sm:text-sm font-bold text-slate-600 hover:text-blue-600 mb-6 bg-white px-4 py-2.5 rounded-xl border border-slate-200 shadow-sm transition-colors"><ArrowLeft size={16} /> {categoriaSeleccionada ? `Volver a ${categoriaSeleccionada}` : "Volver a Causas"}</button>
            <header className="mb-6 bg-white rounded-3xl border border-slate-200/85 p-6 sm:p-8 shadow-xl shadow-slate-200/40 flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
              <div className="flex items-center gap-4 sm:gap-5 min-w-0">
                <div className="bg-blue-50 text-blue-600 p-3.5 sm:p-4 rounded-2xl border border-blue-100 shrink-0"><FolderOpen size={32} /></div>
                <div className="min-w-0">
                  <h2 className="text-xl sm:text-2xl md:text-3xl font-extrabold text-slate-900 tracking-tight break-words">{carpetaActiva.representado?.nombre || "Sin Nombre"}</h2>
                  <div className="flex flex-wrap items-center gap-2.5 mt-2 text-xs sm:text-sm">
                    <span className="font-semibold text-slate-600 bg-slate-100 px-3 py-1 rounded-lg">RUT: {carpetaActiva.representado?.rut || "N/A"}</span>
                    <span className={`inline-flex items-center font-bold px-3 py-1 rounded-lg border text-xs ${getStatusColor(carpetaActiva.estadoCausa || "INGRESADO")}`}>{formatEnumText(carpetaActiva.estadoCausa || "INGRESADO")}</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 w-full md:w-auto shrink-0">
                <button onClick={() => { setCasoEditando(carpetaActiva); setNuevoNombreRepresentado(carpetaActiva.representado?.nombre || ""); setNuevoRutRepresentado(carpetaActiva.representado?.rut || ""); setNuevaAreaJuridica(carpetaActiva.areaJuridica || "CIVIL"); setNuevoEstadoCausa(carpetaActiva.estadoCausa || "INGRESADO"); setNuevasNotasCaso(carpetaActiva.notas || ""); }} className="flex-1 md:flex-none justify-center flex items-center gap-2 px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs sm:text-sm font-bold transition-colors"><Edit3 size={16} /> Editar Carpeta</button>
                <button onClick={() => setCasoAEliminar(carpetaActiva.id)} className="flex-1 md:flex-none justify-center flex items-center gap-2 px-4 py-2.5 bg-rose-50 hover:bg-rose-100 text-rose-600 border border-rose-200 rounded-xl text-xs sm:text-sm font-bold transition-colors"><Trash2 size={16} /> Eliminar</button>
              </div>
            </header>

            {carpetaActiva.notas && (<div className="mb-6 bg-amber-50/90 border border-amber-200 rounded-2xl p-5 shadow-sm text-amber-900"><h4 className="text-sm font-bold flex items-center gap-2 mb-1.5 text-amber-800"><FileSignature size={17} /> Notas del Expediente</h4><p className="text-xs sm:text-sm whitespace-pre-wrap leading-relaxed">{carpetaActiva.notas}</p></div>)}

            <div className="bg-white rounded-3xl border border-slate-200/85 shadow-xl shadow-slate-200/50 overflow-hidden">
              <div className="p-5 sm:p-6 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center"><h3 className="text-base sm:text-lg font-bold text-slate-800 flex items-center gap-2"><FileText size={19} className="text-slate-400" /> Archivos del Expediente <span className="bg-blue-100 text-blue-700 text-xs px-2.5 py-0.5 rounded-full ml-1 font-bold">{carpetaActiva.documentos?.length || 0}</span></h3></div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left border-collapse table-fixed">
                  <thead>
                    <tr className="bg-slate-50/90 border-b border-slate-200 text-slate-500 text-[11px] font-bold uppercase tracking-wider">
                      <th className="py-3.5 px-6 w-[60%]">Documento & Análisis IA</th>
                      <th className="py-3.5 px-5 w-[25%]">Clasificación IA</th>
                      <th className="py-3.5 px-6 w-[15%] text-right">Acciones</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {carpetaActiva.documentos?.map((doc: any) => (
                      <tr key={doc.id} className="hover:bg-slate-50/60 transition-colors group">
                        <td className="py-4 px-6 align-top">
                          <a href={`/api/documentos/${doc.id}/ver`} target="_blank" rel="noopener noreferrer" className="font-bold text-slate-900 hover:text-blue-600 flex items-center gap-3">
                            <div className="p-2 bg-blue-50 text-blue-600 rounded-xl group-hover:bg-blue-600 group-hover:text-white transition-colors shrink-0">{getFileIcon(doc.nombreArchivo, 18)}</div>
                            <span className="truncate text-sm font-bold">{doc.nombreArchivo}</span>
                          </a>
                          <div className="pl-11 mt-1.5">
                            <p className="text-xs text-slate-500 leading-relaxed"><span className="font-semibold text-slate-700">IA:</span> {doc.resumen}</p>
                            {doc.notas && <p className="text-xs text-amber-800 bg-amber-50/80 px-2.5 py-1.5 rounded-lg mt-2 border border-amber-200/70"><span className="font-bold">Notas:</span> {doc.notas}</p>}
                          </div>
                        </td>
                        <td className="py-4 px-5 align-middle">
                          <span className="inline-flex items-center justify-center text-center text-xs font-semibold px-3 py-1.5 rounded-xl border bg-indigo-50/90 text-indigo-700 border-indigo-200/70 leading-tight max-w-full">
                            {doc.materiaLegal || "Documento"}
                          </span>
                        </td>
                        <td className="py-4 px-6 align-middle text-right whitespace-nowrap">
                          <div className="inline-flex items-center justify-end gap-1">
                            <button onClick={() => { setDocEditando(doc); setNuevoNombre(doc.nombreArchivo); setNuevoCasoId(doc.casoId); setNuevoResumen(doc.resumen || ""); setNuevasNotasDoc(doc.notas || ""); }} className="p-2 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all" title="Editar Documento"><Edit3 size={17} /></button>
                            <button onClick={() => setDocAEliminar(doc.id)} className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition-all" title="Eliminar"><Trash2 size={17} /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* MODAL FEEDBACK PROCESANDO IA INDIVIDUAL */}
      {estadoSubida !== "esperando" && (
        <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-md flex items-center justify-center p-4 z-[100] animate-fadeIn">
          <div className="bg-white rounded-3xl max-w-sm w-full p-8 shadow-2xl border border-slate-100 text-center flex flex-col items-center">
            {estadoSubida === "subiendo" && (<><div className="w-16 h-16 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center mb-5 animate-pulse"><Clock className="animate-spin" size={32} /></div><h3 className="text-xl font-extrabold text-slate-900 mb-2">Procesando con IA...</h3></>)}
            {estadoSubida === "exito" && (<><div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mb-5 shadow-inner"><Check size={32} strokeWidth={3} /></div><h3 className="text-xl font-extrabold text-slate-900 mb-2">¡Exitoso!</h3><button onClick={() => { setEstadoSubida("esperando"); setArchivo(null); }} className="w-full mt-4 bg-emerald-600 hover:bg-emerald-700 text-white py-3.5 rounded-2xl text-sm font-bold">Continuar</button></>)}
            {estadoSubida === "error" && (<><div className="w-16 h-16 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mb-5 shadow-inner"><AlertTriangle size={32} /></div><h3 className="text-xl font-extrabold text-slate-900 mb-2">Error</h3><button onClick={() => { setEstadoSubida("esperando"); setArchivo(null); }} className="w-full mt-4 bg-slate-100 text-slate-700 py-3.5 rounded-2xl text-sm font-bold">Cerrar</button></>)}
          </div>
        </div>
      )}

      {/* TOAST NOTIFICACIÓN */}
      {notificacion && (<div className={`fixed bottom-6 right-6 z-[200] flex items-center gap-3 px-5 py-4 rounded-2xl shadow-2xl border animate-fadeIn transition-all duration-300 ${notificacion.tipo === "exito" ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-rose-50 border-rose-200 text-rose-800"}`}><div className={`p-1.5 rounded-full ${notificacion.tipo === "exito" ? "bg-emerald-200/60 text-emerald-600" : "bg-rose-200/60 text-rose-600"}`}>{notificacion.tipo === "exito" ? <CheckCircle size={20} /> : <AlertTriangle size={20} />}</div><p className="font-bold text-sm">{notificacion.mensaje}</p></div>)}

      {/* MODAL EDICIÓN DOCUMENTO */}
      {docEditando && (<div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fadeIn"><div className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-8 shadow-2xl border border-slate-100"><h3 className="text-xl font-extrabold text-slate-900 mb-4">Editar Documento</h3><form onSubmit={guardarEdicion} className="space-y-4 max-h-[70vh] overflow-y-auto pr-2 text-sm"><div><label className="block text-xs font-bold text-slate-700 uppercase mb-1">Nombre Archivo:</label><input type="text" value={nuevoNombre} onChange={(e) => setNuevoNombre(e.target.value)} className="w-full border border-slate-200 rounded-xl p-3 bg-slate-50/50 text-sm outline-none focus:ring-2 focus:ring-blue-500/20" required /></div><div><label className="block text-xs font-bold text-slate-700 uppercase mb-1">Carpeta Destino:</label><select value={nuevoCasoId} onChange={(e) => setNuevoCasoId(e.target.value)} className="w-full border border-slate-200 rounded-xl p-3 bg-slate-50/50 text-sm outline-none focus:ring-2 focus:ring-blue-500/20">{casos.map((c) => (<option key={c.id} value={c.id}>{c.representado?.nombre || "Sin Nombre"} ({formatEnumText(c.areaJuridica)})</option>))}</select></div><div><label className="block text-xs font-bold text-slate-700 uppercase mb-1">Resumen / Análisis IA (Editable):</label><textarea value={nuevoResumen} onChange={(e) => setNuevoResumen(e.target.value)} className="w-full border border-slate-200 rounded-xl p-3 bg-slate-50/50 min-h-[100px] text-sm outline-none focus:ring-2 focus:ring-blue-500/20" /></div><div><label className="block text-xs font-bold text-slate-700 uppercase mb-1">Notas Internas:</label><textarea value={nuevasNotasDoc} onChange={(e) => setNuevasNotasDoc(e.target.value)} placeholder="Añade notas privadas para este documento..." className="w-full border border-amber-200 rounded-xl p-3 bg-amber-50/30 min-h-[80px] text-sm outline-none focus:ring-2 focus:ring-amber-500/20" /></div><div className="flex gap-3 pt-4"><button type="button" onClick={() => setDocEditando(null)} className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 py-3 rounded-xl text-sm font-bold transition-colors">Cancelar</button><button type="submit" className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-xl text-sm font-bold transition-colors">Guardar</button></div></form></div></div>)}

      {/* MODAL EDICIÓN CASO */}
      {casoEditando && (<div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fadeIn"><div className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-8 shadow-2xl border border-slate-100"><h3 className="text-xl font-extrabold text-slate-900 mb-4">Editar Expediente</h3><form onSubmit={guardarEdicionCaso} className="space-y-4 max-h-[70vh] overflow-y-auto pr-2 text-sm"><div className="grid grid-cols-1 sm:grid-cols-2 gap-4"><div><label className="block text-xs font-bold text-slate-700 uppercase mb-1">Nombre:</label><input type="text" value={nuevoRutRepresentado} onChange={(e) => setNuevoRutRepresentado(formatearRUT(e.target.value))} className="w-full border border-slate-200 rounded-xl p-3 bg-slate-50/50 text-sm outline-none" placeholder="Ej: 12.345.678-9" required /></div><div><label className="block text-xs font-bold text-slate-700 uppercase mb-1">RUT:</label><input type="text" value={nuevoRutRepresentado} onChange={(e) => setNuevoRutRepresentado(e.target.value)} className="w-full border border-slate-200 rounded-xl p-3 bg-slate-50/50 text-sm outline-none" /></div></div><div className="grid grid-cols-1 sm:grid-cols-2 gap-4"><div><label className="block text-xs font-bold text-slate-700 uppercase mb-1">Área Jurídica:</label><select value={nuevaAreaJuridica} onChange={(e) => setNuevaAreaJuridica(e.target.value)} className="w-full border border-slate-200 rounded-xl p-3 bg-slate-50/50 text-sm outline-none">{categoriasLegales.map(cat => <option key={cat} value={cat}>{formatEnumText(cat)}</option>)}</select></div><div><label className="block text-xs font-bold text-slate-700 uppercase mb-1">Estado de Causa:</label><select value={nuevoEstadoCausa} onChange={(e) => setNuevoEstadoCausa(e.target.value)} className="w-full border border-blue-200 rounded-xl p-3 bg-blue-50/50 text-sm font-semibold text-blue-800 outline-none">{estadosLegales.map(est => <option key={est} value={est}>{formatEnumText(est)}</option>)}</select></div></div><div><label className="block text-xs font-bold text-slate-700 uppercase mb-1">Notas del Expediente:</label><textarea value={nuevasNotasCaso} onChange={(e) => setNuevasNotasCaso(e.target.value)} placeholder="Ej: Faltan firmas..." className="w-full border border-amber-200 rounded-xl p-3 bg-amber-50/30 min-h-[120px] text-sm outline-none" /></div><div className="flex gap-3 pt-4"><button type="button" onClick={() => setCasoEditando(null)} className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 py-3 rounded-xl text-sm font-bold transition-colors">Cancelar</button><button type="submit" className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-3 rounded-xl text-sm font-bold transition-colors">Guardar</button></div></form></div></div>)}

      {/* MODALES ELIMINAR */}
      {docAEliminar && (<div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fadeIn"><div className="bg-white rounded-3xl max-w-sm w-full p-8 text-center shadow-2xl border border-slate-100"><div className="w-16 h-16 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto mb-5 shadow-inner"><AlertTriangle size={32} /></div><h3 className="text-xl font-extrabold text-slate-900 mb-8">¿Eliminar archivo?</h3><div className="flex gap-3"><button onClick={() => setDocAEliminar(null)} className="flex-1 bg-slate-100 text-slate-700 py-3 rounded-xl text-sm font-bold">Cancelar</button><button onClick={ejecutarEliminacion} className="flex-1 bg-rose-600 text-white py-3 rounded-xl text-sm font-bold">Eliminar</button></div></div></div>)}
      {casoAEliminar && (<div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fadeIn"><div className="bg-white rounded-3xl max-w-sm w-full p-8 text-center shadow-2xl border border-slate-100"><div className="w-16 h-16 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mx-auto mb-5 shadow-inner"><AlertTriangle size={32} /></div><h3 className="text-xl font-extrabold text-slate-900 mb-2">¿Eliminar Carpeta?</h3><p className="text-xs sm:text-sm text-rose-500 mb-8 font-semibold">Se eliminarán todos los documentos.</p><div className="flex gap-3"><button onClick={() => setCasoAEliminar(null)} className="flex-1 bg-slate-100 text-slate-700 py-3 rounded-xl text-sm font-bold">Cancelar</button><button onClick={ejecutarEliminacionCaso} className="flex-1 bg-rose-600 text-white py-3 rounded-xl text-sm font-bold">Sí, Eliminar</button></div></div></div>)}
    </div>
  );
}