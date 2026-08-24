'use strict';
// Mantem compatibilidade com um handler legado gerado como async(fn).
// Retorna a propria funcao sem alterar seu contexto ou argumentos.
var async = (fn) => fn;
