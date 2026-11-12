//#region src/typeTransform.d.ts
type TransformParameterFn = (parameter: {
  type_oid: number;
}) => {
  type: string;
  imports?: {
    name: string;
    path: string;
  }[];
};
type TransformFieldFn = (field: {
  type_oid: number;
  name: string;
  column?: {
    schemaName: string;
    tableName: string;
    columnName: string;
    nullable: boolean;
  };
}) => {
  type: string;
  imports?: {
    name: string;
    path: string;
  }[];
};
declare const defaultTransformParameter: TransformParameterFn;
declare const defaultTransformField: TransformFieldFn;
//#endregion
//#region src/index.d.ts
interface PgTypesafeConfig {
  tsConfigFile?: string;
  definitionsFile?: string;
  connectionString?: string;
  /**
   * List of files or directories to ignore. It doesn't support paths (aa/bb) nor globs
   * @example ['__tests__', 'bad_file.ts']
   */
  ignoreFiles?: string[];
  transformParameter?: TransformParameterFn;
  transformField?: TransformFieldFn;
}
declare const defineConfig: (config: PgTypesafeConfig) => PgTypesafeConfig;
//#endregion
export { PgTypesafeConfig, type TransformFieldFn, type TransformParameterFn, defaultTransformField, defaultTransformParameter, defineConfig };