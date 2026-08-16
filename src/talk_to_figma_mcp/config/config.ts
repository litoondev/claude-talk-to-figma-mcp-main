import { z } from "zod";

// Argumentos de línea de comandos
const args = process.argv.slice(2);
const serverArg = args.find(arg => arg.startsWith('--server='));
const portArg = args.find(arg => arg.startsWith('--port='));
const reconnectArg = args.find(arg => arg.startsWith('--reconnect-interval='));

// Configuración de conexión extraída de argumentos CLI
export const serverUrl = serverArg ? serverArg.split('=')[1] : 'localhost';
export const defaultPort = portArg ? parseInt(portArg.split('=')[1], 10) : 3055;
export const reconnectInterval = reconnectArg ? parseInt(reconnectArg.split('=')[1], 10) : 2000;

// URL de WebSocket basada en el servidor (WS para localhost, WSS para remoto)
export const WS_URL = serverUrl === 'localhost' ? `ws://${serverUrl}` : `wss://${serverUrl}`;

// Configuración del servidor MCP
export const SERVER_CONFIG = {
  name: "ClaudeTalkToFigmaMCP",
  description: "Claude MCP Plugin for Figma",
  version: "0.4.0",
};

/**
 * Configuración del cliente REST de Figma (api.figma.com).
 *
 * Se usa únicamente para funcionalidades que la Plugin API no expone —
 * actualmente los comentarios. Requiere un personal access token en la
 * variable de entorno FIGMA_ACCESS_TOKEN.
 *
 * El token NO se lee aquí a propósito: `getFigmaToken()` lo consulta en cada
 * llamada para que el entorno pueda cambiar sin reiniciar el módulo.
 */
/**
 * Lee un entero positivo de una variable de entorno.
 *
 * Importante: las variables inyectadas desde un manifiesto DXT llegan como
 * cadena vacía cuando el usuario deja el campo en blanco, y `Number("")` es 0.
 * Por eso descartamos vacíos, NaN y valores <= 0 y caemos al valor por defecto.
 */
function envInt(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export const FIGMA_REST_CONFIG = {
  baseUrl: process.env.FIGMA_API_BASE_URL?.trim() || "https://api.figma.com",
  /** Reintentos adicionales tras el primer intento (429/408/5xx y errores de red). */
  maxRetries: envInt(process.env.FIGMA_API_MAX_RETRIES, 3),
  /** Peticiones simultáneas máximas al barrer varios archivos. */
  concurrency: envInt(process.env.FIGMA_API_CONCURRENCY, 4),
  /** Timeout por petición en ms. */
  timeoutMs: envInt(process.env.FIGMA_API_TIMEOUT_MS, 30000),
  baseBackoffMs: 500,
  maxBackoffMs: 15000,
};