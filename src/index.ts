#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import pg from 'pg';
const { Client } = pg;
import { config } from 'dotenv';

// Load environment variables from .env file
config();

// Type guard for error objects
function isErrorWithMessage(error: unknown): error is { message: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as Record<string, unknown>).message === 'string'
  );
}

// Helper to get error message
function getErrorMessage(error: unknown): string {
  if (isErrorWithMessage(error)) {
    return error.message;
  }
  return String(error);
}

// Helper to convert ? parameters to $1, $2, etc.
function convertToNamedParams(query: string): string {
  let paramIndex = 0;
  return query.replace(/\?/g, () => `$${++paramIndex}`);
}

class PostgresServer {
  private server: Server;
  private client: pg.Client | null = null;
  private connectionUrl: string | null = null; // Store the connection URL

  constructor() {
    this.server = new Server(
      {
        name: 'postgres-server',
        version: '1.1.0', // Version bump
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Attempt to get connection URL from environment on initialization
    this.connectionUrl = this.getConnectionUrlFromEnv();
    if (!this.connectionUrl) {
      console.error(
        '[MCP Error] Database connection URL not found. Set the CLAUDE_POSTGRES_API_KEY environment variable.'
      );
      // Optionally exit if connection is mandatory from the start
      // process.exit(1);
    } else {
        console.error('[MCP Info] Using database connection URL from CLAUDE_POSTGRES_API_KEY');
    }

    this.setupToolHandlers();

    // Error handling
    this.server.onerror = (error) => console.error('[MCP Error]', error);
    const handleTermination = async () => {
      console.error('[MCP Info] Termination signal received. Cleaning up...');
      try {
        await this.cleanup();
      } catch (error) {
        console.error('Error during cleanup:', error);
        process.exit(1); // Exit with error code if cleanup fails
      }
      console.error('[MCP Info] Cleanup complete. Exiting.');
      process.exit(0); // Exit successfully
    };
    process.on('SIGINT', handleTermination);
    process.on('SIGTERM', handleTermination); // Handle SIGTERM too
    process.stdin.on('close', handleTermination);
  }

  private async cleanup() {
    if (this.client) {
      console.error('[MCP Info] Closing database connection...');
      await this.client.end();
      this.client = null; // Clear the client reference
      console.error('[MCP Info] Database connection closed.');
    }
    console.error('[MCP Info] Closing MCP server...');
    await this.server.close();
    console.error('[MCP Info] MCP server closed.');
  }

  // Reads the connection URL from the specific environment variable
  private getConnectionUrlFromEnv(): string | null {
    return process.env.CLAUDE_POSTGRES_API_KEY || null;
  }

  private async ensureConnection() {
    // If URL is not set at all, throw error immediately
    if (!this.connectionUrl) {
        // Re-check env var in case it was set after startup (unlikely in stdio model, but safe)
        this.connectionUrl = this.getConnectionUrlFromEnv();
        if (!this.connectionUrl) {
             throw new McpError(
                ErrorCode.InvalidRequest, // Or maybe InternalError depending on semantics
                'Database connection URL not configured. Set the CLAUDE_POSTGRES_API_KEY environment variable.'
             );
        }
    }

    // If client exists and is active, assume connection is good
    // Note: pg.Client doesn't have a straightforward 'isActive' check without querying
    if (this.client) {
      // Optional: Add a simple query like 'SELECT 1' to truly check connection health
      // try {
      //   await this.client.query('SELECT 1');
      //   return; // Connection is good
      // } catch (connectionError) {
      //   console.error('[MCP Warn] Existing connection seems dead, attempting reconnect.', connectionError);
      //   await this.client.end().catch(endErr => console.error('[MCP Error] Error ending dead client:', endErr)); // Attempt cleanup
      //   this.client = null; // Force re-creation below
      // }
      return; // Assume connection is good for now if client object exists
    }


    // If client doesn't exist (or was cleared above), create and connect
    if (!this.client) {
      try {
        console.error('[MCP Info] Establishing new database connection...');
        this.client = new Client({
          connectionString: this.connectionUrl,
          // The connectionString handles SSL parameters like sslmode=require etc.
          // Add specific SSL certs here if needed, e.g.:
          // ssl: {
          //   rejectUnauthorized: true, // Default varies by Node/pg version, often true
          //   ca: process.env.PG_SSL_CA_CERT,
          //   key: process.env.PG_SSL_KEY,
          //   cert: process.env.PG_SSL_CERT,
          // }
        });
        await this.client.connect();
        console.error('[MCP Info] Database connection established successfully.');

        // Handle client errors after connection
        this.client.on('error', (err) => {
            console.error('[MCP Error] PostgreSQL client error:', err);
            // Attempt to cleanup and nullify client so next ensureConnection tries again
            this.client?.end().catch(endErr => console.error('[MCP Error] Error ending client after error:', endErr));
            this.client = null;
        });

      } catch (error) {
        this.client = null; // Ensure client is null if connection fails
        throw new McpError(
          ErrorCode.InternalError,
          `Failed to connect to database: ${getErrorMessage(error)}`
        );
      }
    }
  }


  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        // connect_db tool removed as connection is now configured via environment variable
        {
          name: 'query',
          description: 'Execute a SELECT query. Connection uses CLAUDE_POSTGRES_API_KEY env var.',
          inputSchema: {
            type: 'object',
            properties: {
              sql: {
                type: 'string',
                description: 'SQL SELECT query (use $1, $2, etc. for parameters)',
              },
              params: {
                type: 'array',
                items: {
                  type: ['string', 'number', 'boolean', 'null'],
                },
                description: 'Query parameters (optional)',
                default: [], // Add default empty array
              },
            },
            required: ['sql'],
          },
        },
        {
          name: 'execute',
          description: 'Execute an INSERT, UPDATE, or DELETE query. Connection uses CLAUDE_POSTGRES_API_KEY env var.',
          inputSchema: {
            type: 'object',
            properties: {
              sql: {
                type: 'string',
                description: 'SQL query (INSERT, UPDATE, DELETE) (use $1, $2, etc. for parameters)',
              },
              params: {
                type: 'array',
                items: {
                  type: ['string', 'number', 'boolean', 'null'],
                },
                description: 'Query parameters (optional)',
                default: [], // Add default empty array
              },
            },
            required: ['sql'],
          },
        },
        {
          name: 'list_tables',
          description: 'List all tables in the public schema of the database. Connection uses CLAUDE_POSTGRES_API_KEY env var.',
          inputSchema: {
            type: 'object',
            properties: {}, // No arguments needed
            required: [],
          },
        },
        {
          name: 'describe_table',
          description: 'Get table structure (columns, types, nullability, primary key). Connection uses CLAUDE_POSTGRES_API_KEY env var.',
          inputSchema: {
            type: 'object',
            properties: {
              table: {
                type: 'string',
                description: 'Table name',
              },
            },
            required: ['table'],
          },
        },
      ],
    }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      // Ensure connection before handling any tool call that requires it
      if (['query', 'execute', 'list_tables', 'describe_table'].includes(request.params.name)) {
         await this.ensureConnection();
      }

      switch (request.params.name) {
        // connect_db case removed
        case 'query':
          return await this.handleQuery(request.params.arguments);
        case 'execute':
          return await this.handleExecute(request.params.arguments);
        case 'list_tables':
          return await this.handleListTables();
        case 'describe_table':
          return await this.handleDescribeTable(request.params.arguments);
        default:
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${request.params.name}`
          );
      }
    });
  }

  // handleConnectDb method removed

  private async handleQuery(args: any) {
    // ensureConnection already called by the central request handler

    if (!args || typeof args.sql !== 'string') { // Basic validation
      throw new McpError(ErrorCode.InvalidParams, 'SQL query string is required in arguments');
    }

    if (!args.sql.trim().toUpperCase().startsWith('SELECT')) {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Only SELECT queries are allowed with the "query" tool. Use "execute" for INSERT/UPDATE/DELETE.'
      );
    }

    try {
      // Convert ? parameters to $1, $2, etc. if needed
      const sql = args.sql.includes('?') ? convertToNamedParams(args.sql) : args.sql;
      const params = Array.isArray(args.params) ? args.params : []; // Ensure params is an array
      const result = await this.client!.query(sql, params); // Non-null assertion ok due to ensureConnection

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result.rows, null, 2), // Pretty print JSON
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Query execution failed: ${getErrorMessage(error)}`
      );
    }
  }

  private async handleExecute(args: any) {
    // ensureConnection already called by the central request handler

    if (!args || typeof args.sql !== 'string') { // Basic validation
      throw new McpError(ErrorCode.InvalidParams, 'SQL query string is required in arguments');
    }

    const command = args.sql.trim().toUpperCase().split(' ')[0];
    if (command === 'SELECT') {
      throw new McpError(
        ErrorCode.InvalidParams,
        'Use the "query" tool for SELECT statements.'
      );
    }
    if (!['INSERT', 'UPDATE', 'DELETE', 'CREATE', 'ALTER', 'DROP', 'TRUNCATE'].includes(command)) {
        // Optionally restrict further, e.g., only allow DML
        console.warn(`[MCP Warn] Executing potentially dangerous command: ${command}`);
    }


    try {
      // Convert ? parameters to $1, $2, etc. if needed
      const preparedSql = args.sql.includes('?') ? convertToNamedParams(args.sql) : args.sql;
      const params = Array.isArray(args.params) ? args.params : []; // Ensure params is an array
      const result = await this.client!.query(preparedSql, params); // Non-null assertion ok

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              rowCount: result.rowCount ?? 0, // rowCount can be null for non-DML
              command: result.command,
            }, null, 2), // Pretty print JSON
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Execute command failed: ${getErrorMessage(error)}`
      );
    }
  }

  private async handleListTables() {
    // ensureConnection already called by the central request handler

    try {
      const result = await this.client!.query(`
        SELECT table_name
        FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
        ORDER BY table_name
      `); // Added table_type filter

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result.rows.map(row => row.table_name), null, 2), // Return array of names
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to list tables: ${getErrorMessage(error)}`
      );
    }
  }

  private async handleDescribeTable(args: any) {
     // ensureConnection already called by the central request handler

    if (!args || typeof args.table !== 'string') { // Basic validation
      throw new McpError(ErrorCode.InvalidParams, 'Table name string is required in arguments');
    }

    try {
        // Use parameterized query for safety
      const result = await this.client!.query(`
        SELECT
          c.column_name,
          c.data_type,
          c.udt_name, -- User defined type name (more specific, e.g., _text for text array)
          c.is_nullable,
          c.column_default,
          CASE
            WHEN pk.constraint_type = 'PRIMARY KEY' THEN true
            ELSE false
          END AS is_primary_key,
          c.character_maximum_length,
          c.numeric_precision,
          c.numeric_scale
        FROM
          information_schema.columns c
        LEFT JOIN (
          SELECT
            kcu.column_name,
            kcu.table_schema,
            kcu.table_name,
            tc.constraint_type
          FROM
            information_schema.key_column_usage kcu
          JOIN
            information_schema.table_constraints tc
          ON
            kcu.constraint_name = tc.constraint_name
            AND kcu.table_schema = tc.table_schema
            AND kcu.table_name = tc.table_name
          WHERE
            tc.constraint_type = 'PRIMARY KEY'
        ) pk
        ON
          c.column_name = pk.column_name
          AND c.table_schema = pk.table_schema
          AND c.table_name = pk.table_name
        WHERE
          c.table_schema = 'public'
          AND c.table_name = $1
        ORDER BY
          c.ordinal_position;
      `, [args.table]);

      if (result.rows.length === 0) {
           return {
                content: [
                    {
                        type: 'text',
                        text: `Table "public.${args.table}" not found or has no columns.`,
                    },
                ],
           };
      }

      return {
        content: [
          {
            type: 'text',
            // Pretty print JSON output
            text: JSON.stringify(result.rows, null, 2),
          },
        ],
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InternalError,
        `Failed to describe table "${args.table}": ${getErrorMessage(error)}`
      );
    }
  }

  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('PostgreSQL MCP server running on stdio. Waiting for requests...');
  }
}

// --- Main Execution ---
(async () => {
    try {
        const server = new PostgresServer();
        await server.run();
    } catch (error) {
        console.error('[MCP Fatal] Failed to initialize or run the server:', error);
        process.exit(1);
    }
})();
