#!/usr/bin/env node
import { n as defaultTransformParameter, t as defaultTransformField } from "./typeTransform-w8GmSwgY.mjs";
import assert from "node:assert";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { argv, cwd } from "node:process";
import { inspect, parseArgs } from "node:util";
import { Client } from "pg";
import { Project, SyntaxKind } from "ts-morph";
import "pg-protocol/dist/messages";
import assert$1 from "assert";
//#region src/describe.ts
var Describer = class {
	promise;
	resolve;
	reject;
	data;
	query;
	constructor(query) {
		this.data = {};
		this.query = query;
		this.promise = new Promise((resolve, reject) => {
			this.resolve = resolve;
			this.reject = reject;
		});
	}
	submit(conn) {
		conn.parse({
			name: "",
			types: [],
			text: this.query
		}, false);
		conn.describe({
			name: "",
			type: "S"
		}, false);
		conn.flush();
		const cleanup = () => {
			conn.removeListener("message", listener);
			conn.sync();
		};
		const listener = (msg) => {
			switch (msg.name) {
				case "parseComplete": break;
				case "parameterDescription":
					this.data.parameterOids = msg.dataTypeIDs;
					break;
				case "rowDescription":
					this.data.fields = msg.fields;
					break;
				case "noData":
					this.data.fields = [];
					break;
				case "error":
					cleanup();
					this.reject?.(msg);
					return;
				default:
					cleanup();
					this.reject?.(/* @__PURE__ */ new Error(`Unexpected message ${msg.name}`));
					return;
			}
			const fields = this.data.fields;
			const parameterOids = this.data.parameterOids;
			if (fields && parameterOids) {
				cleanup();
				this.resolve?.({
					fields,
					parameterOids
				});
			}
		};
		conn.addListener("message", listener);
	}
	handleRowDescription() {}
	handleError() {}
	handleReadyForQuery() {}
};
//#endregion
//#region src/analyzeQuery.ts
const analyzeQuery = async (client, query) => {
	const describer = new Describer(query);
	client.query(describer);
	const desc = await describer.promise;
	if (desc === null) return null;
	const tableOids = desc.fields.map((f) => f.tableID).filter((f) => f !== 0);
	const t_names = await client.query("select oid table_oid, relname table_name, relnamespace::regnamespace::text table_schema from pg_class where oid = any($1)", [tableOids]);
	const col_names = await client.query("select attrelid table_oid,attname column_name, attnum column_number from pg_attribute where attrelid = any($1)", [tableOids]);
	const col_constraints = await client.query("select conrelid table_oid ,contype, conkey column_ids from pg_catalog.pg_constraint where conrelid = any($1)", [tableOids]);
	return {
		parameters: desc.parameterOids.map((oid) => ({ type_oid: oid })),
		fields: desc.fields.map((f) => {
			const base = {
				type_oid: f.dataTypeID,
				name: f.name
			};
			if (f.tableID === 0) return base;
			const t_name = t_names.rows.find((r) => r.table_oid === f.tableID);
			const col_name = col_names.rows.find((r) => r.table_oid === f.tableID && r.column_number === f.columnID);
			const col_constraint = col_constraints.rows.find((r) => r.table_oid === f.tableID && r.column_ids.some((c) => c === f.columnID) && ["n", "p"].includes(r.contype));
			assert$1(t_name);
			assert$1(col_name);
			return {
				...base,
				column: {
					schemaName: t_name.table_schema,
					tableName: t_name.table_name,
					columnName: col_name.column_name,
					nullable: col_constraint === void 0
				}
			};
		})
	};
};
//#endregion
//#region src/cli.ts
const head = `import { type Pool, type PoolClient, type Client, type QueryResultBase } from "pg";

export type TypesafeQueryFn = <T extends keyof Queries>(
  query: T,
  ...args: Queries[T]["parameters"] extends []
      ? []
      : [values: Queries[T]["parameters"]]
) => Promise<QueryResultBase & { rows: Queries[T]["fields"][] }>;

export type TypesafePoolClient = Omit<PoolClient, 'query'> & { query: TypesafeQueryFn; }
export type TypesafeClient = Omit<Client, 'query'> & { query: TypesafeQueryFn; }
export type TypesafePool = Omit<Pool, 'query' | 'connect'> & { query: TypesafeQueryFn; connect(): Promise<TypesafePoolClient>; }
export type TypesafeQuerier = { query: TypesafeQueryFn; }
`;
const buildQueryObj = (data) => {
	if (!data) data = /* @__PURE__ */ new Map();
	return `export interface Queries {
${data.entries().map(([k, v]) => {
		return `  [\`${k}\`]: { parameters: ${"[" + v.parameters.join(", ") + "]"}; fields: ${"{" + v.fields.map((f) => `${f.k}: ${f.v}`).join("; ") + "}"};}`;
	}).toArray().join("\n")}
}`;
};
const msg = (loc, type, line1, line2) => {
	console.log(`${loc}: ${type}: ${line1}`);
	if (line2) console.log(`    ${line2}`);
	console.log();
};
const readConfig = async () => {
	const { values: args } = parseArgs({
		args: argv.slice(2),
		options: {
			connectionString: { type: "string" },
			definitionsFile: { type: "string" },
			tsConfigFile: { type: "string" },
			configFile: {
				type: "string",
				default: "pg-typesafe.config.ts"
			}
		}
	});
	const _config = await import(resolve(cwd(), args.configFile)).catch((e) => {
		console.log(`notice: could not read ${args.configFile}`);
		return null;
	});
	if (!_config?.default) {
		console.log(`warning: ${args.configFile} must export the config as default.`);
		console.log("  example: export default defineConfig({})");
	}
	const config = _config?.default ?? {};
	return {
		connectionString: args.connectionString ?? config?.connectionString,
		definitionsFile: args.definitionsFile ?? config?.definitionsFile ?? "src/defs.gen.ts",
		tsConfigFile: args.tsConfigFile ?? config?.tsConfigFile ?? "tsconfig.json",
		transformParameter: config?.transformParameter ?? defaultTransformParameter,
		transformField: config?.transformField ?? defaultTransformField,
		ignoreFiles: config.ignoreFiles ?? []
	};
};
const config = await readConfig();
const project = new Project({ tsConfigFilePath: config.tsConfigFile });
const defFile = config.definitionsFile;
if (!existsSync(defFile)) {
	await writeFile(defFile, head + "\n" + buildQueryObj(), "utf-8");
	project.addSourceFileAtPath(defFile);
	project.resolveSourceFileDependencies();
}
const queries = [];
project.getSourceFiles().forEach((file) => {
	const relativePath = relative(".", file.getFilePath());
	if (relativePath.split("/").some((part) => config.ignoreFiles.includes(part))) return;
	file.getDescendantsOfKind(SyntaxKind.CallExpression).forEach((call) => {
		const expression = call.getExpression();
		if (expression.getKind() === SyntaxKind.PropertyAccessExpression) {
			const propAccess = expression.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
			if (propAccess.getName() !== "query") return;
			const type = propAccess.getType();
			const { line, column } = file.getLineAndColumnAtPos(call.getStart());
			const loc = `${relativePath}:${line}:${column}`;
			if (!type.getText().endsWith("TypesafeQueryFn")) {
				msg(loc, "notice", `call of ${propAccess.getExpression().getText()}.name is not of type TypesafeQueryFn`, `If this call is a database call, type ${propAccess.getExpression().getText()} as TypesafePool, TypesafeClient or TypesafeQuerier`);
				return;
			}
			const arg = call.getArguments().at(0);
			if (!arg) {
				msg(loc, "warning", "call has no arguments");
				return;
			}
			if (arg.getKind() !== SyntaxKind.NoSubstitutionTemplateLiteral && arg.getKind() !== SyntaxKind.StringLiteral) {
				msg(loc, "notice", `the argument is a ${arg.getKindName()}, which is unsupported`, `pg-typesafe currently supports string literals and template literals with not substitution.`);
				return;
			}
			const txt = arg.asKind(SyntaxKind.StringLiteral)?.compilerNode.text ?? arg.asKind(SyntaxKind.NoSubstitutionTemplateLiteral)?.compilerNode.text;
			assert(txt !== void 0);
			queries.push({
				query: txt,
				loc
			});
		}
	});
});
const client = new Client({ connectionString: config.connectionString });
await client.connect();
const impMap = /* @__PURE__ */ new Map();
const pushImports = (imports) => {
	(imports ?? []).forEach((imp) => {
		let items = impMap.get(imp.path);
		if (!items) {
			items = [];
			impMap.set(imp.path, items);
		}
		items.push(imp.name);
	});
};
const qMap = /* @__PURE__ */ new Map();
for (const q of queries) try {
	const analyzed = await analyzeQuery(client, q.query);
	if (analyzed === null) qMap.set(q.query, {
		parameters: [],
		fields: []
	});
	else {
		const parameters = analyzed.parameters.map((p) => {
			const t = config.transformParameter(p);
			pushImports(t.imports);
			return t.type;
		});
		const fields = analyzed.fields.map((f) => {
			const t = config.transformField(f);
			pushImports(t.imports);
			return {
				k: f.name,
				v: t.type
			};
		});
		qMap.set(q.query, {
			parameters,
			fields
		});
	}
} catch (error) {
	msg(q.loc, "warning", "analyzing this query failed", inspect(error));
}
await client.end();
await writeFile(defFile, [
	impMap.entries().map(([path, names]) => `import type { ${names.join(", ")} } from '${path}';`).toArray().join("\n"),
	head,
	buildQueryObj(qMap)
].join("\n"), "utf-8");
//#endregion
export {};
