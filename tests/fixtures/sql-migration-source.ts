/** Use committed SQL semantics independently of checkout EOL conversion. Raw
 * CRLF inside PL/pgSQL bodies would break later migrations' literal LF anchors.
 * Do not rewrite SQL escapes, whitespace or the migration files on disk. */
export const sqlMigrationSource=(source:string)=>source.replace(/\r\n/g,'\n');
