#!/usr/bin/env node
// Entry point del binario `comparar`.
// Construye el programa CLI y parsea los argumentos de la línea de comandos.

import { buildProgram } from "./cli/index.js";

// `parseAsync` soporta acciones asíncronas (el handler de "comparar" lo es).
// Cualquier error de parseo lo maneja commander; los de ejecución se manejan
// dentro de la acción del comando, que ajusta `process.exitCode`.
await buildProgram().parseAsync(process.argv);
