# MCP PostgreSQL Server

A Model Context Protocol server that provides PostgreSQL database operations. This server enables AI models to interact with PostgreSQL databases through a standardized interface.

## Installation

### Manual Installation

```bash
npm install mcp-postgres-server
```

Or run directly with:

```bash
npx mcp-postgres-server
```

## Configuration

The server requires the following environment variables:

```json
{
  "mcpServers": {
    "postgres": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "mcp-postgres-server"],
      "env": {
        "PG_HOST": "your_host",
        "PG_PORT": "5432",
        "PG_USER": "your_user",
        "PG_PASSWORD": "your_password",
        "PG_DATABASE": "your_database"
      }
    }
  }
}
```

## Available Tools

### 1. connect_db

Establish connection to PostgreSQL database using provided credentials.

```javascript
use_mcp_tool({
  server_name: "postgres",
  tool_name: "connect_db",
  arguments: {
    host: "localhost",
    port: 5432,
    user: "your_user",
    password: "your_password",
    database: "your_database"
  }
});
```

### 2. query

Execute SELECT queries with optional prepared statement parameters. Supports both PostgreSQL-style ($1, $2) and MySQL-style (?) parameter placeholders.

```javascript
use_mcp_tool({
  server_name: "postgres",
  tool_name: "query",
  arguments: {
    sql: "SELECT * FROM users WHERE id = $1",
    params: [1]
  }
});
```

### 3. execute

Execute INSERT, UPDATE, or DELETE queries with optional prepared statement parameters. Supports both PostgreSQL-style ($1, $2) and MySQL-style (?) parameter placeholders.

```javascript
use_mcp_tool({
  server_name: "postgres",
  tool_name: "execute",
  arguments: {
    sql: "INSERT INTO users (name, email) VALUES ($1, $2)",
    params: ["John Doe", "john@example.com"]
  }
});
```

### 4. list_tables

List all tables in the connected database.

```javascript
use_mcp_tool({
  server_name: "postgres",
  tool_name: "list_tables",
  arguments: {}
});
```

### 5. describe_table

Get the structure of a specific table.

```javascript
use_mcp_tool({
  server_name: "postgres",
  tool_name: "describe_table",
  arguments: {
    table: "users"
  }
});
```

## Features

* Secure connection handling with automatic cleanup
* Prepared statement support for query parameters
* Support for both PostgreSQL-style ($1, $2) and MySQL-style (?) parameter placeholders
* Comprehensive error handling and validation
* TypeScript support
* Automatic connection management
* Supports PostgreSQL-specific syntax and features

## Security

* Uses prepared statements to prevent SQL injection
* Supports secure password handling through environment variables
* Validates queries before execution
* Automatically closes connections when done

## Error Handling

The server provides detailed error messages for common issues:

* Connection failures
* Invalid queries
* Missing parameters
* Database errors

## License

MIT