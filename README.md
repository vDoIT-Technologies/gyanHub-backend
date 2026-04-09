# Sentience Project

Sentience is an AI-powered chat bot called Sophia that provides intelligent responses. This project uses PostgreSQL for
data storage, pgvector for vector operations, and integrates with OpenAI's language models.

## Prerequisites

- Docker and Docker Compose
- Bun (for running the application)

## Project Structure

```
sentience/
│
├── src/
│   ├── auth/
│   ├── middleware/
│   │   ├── auth.middleware.js
│   │   └── jwt.middleware.js
│   ├── routes/
│   │   ├── chat.js
│   │   ├── user.js
│   │   └── wallet.js
│   ├── services/
│   │   ├── ChatService.js
│   │   ├── UserService.js
│   │   ├── VectorDBService.js
│   │   └── WalletService.js
│   ├── utils/
│   └── index.js
│
├── prisma/
│   └── schema.prisma
│
├── docker-compose.yml
├── init.sql
├── jsconfig.json
├── bun.lockb
├── package.json
└── README.md
```

## Getting Started

1. Clone the repository:

    ```
    git clone https://github.com/vDoIT-Technologies/sentience-backend.git
    cd sentience-backend
    ```

2. Create a `.env` file in the root directory with the following content:

    ```
    DATABASE_URL="postgresql://superadmin:superadmin@localhost:5436/sentience?schema=public"
    PG_HOST="localhost"
    PG_PORT="5435"
    PG_USER="superadmin"
    PG_PASSWORD="superadmin"
    PG_DATABASE="sentience_vectordb"
    OPENAI_API_KEY="your_open_ai_api_key"
    NODE_ENV="development"
    JWT_SECRET="your_jwt_secret"
    ```

    Replace `your_openai_api_key` and `your_jwt_secret` with your actual values.

3. Start the Docker containers:

    ```
    docker-compose up -d
    ```

4. Install dependencies:

    ```
    bun install
    ```

5. Run database migrations:

    ```
    bunx prisma generate
    bunx prisma db push
    ```

6. Start the development server:

    ```
    bun run dev
    ```

The server should now be running at `http://localhost:3009`.

## Key Components

- **ChatService**: Manages chat sessions and interactions with the AI model.
- **UserService**: Handles user-related operations.
- **WalletService**: Manages wallet functionality.
- **VectorDBService**: Interfaces with pgvector for AI-related vector operations.
- **Authentication Middleware**: Provides JWT-based authentication.

## API Endpoints

- Chat Routes (`/api/chat/*`): Manage chat sessions and messages
- User Routes (`/api/users/*`): Handle user operations
- Wallet Routes (`/api/wallets/*`): Manage wallet functionalities

For detailed API documentation, please refer to the individual route files in the `src/routes` directory.

## Development

- Use `bun run dev` for hot-reloading during development.
- The project uses Prisma as an ORM. After making changes to `schema.prisma`, run `bunx prisma generate` to update the
  Prisma client.

## Docker

The project includes two Docker services:

1. `vectordb`: PostgreSQL with pgvector extension for vector operations.
2. `db`: Standard PostgreSQL database for storing application data.

To rebuild the Docker images:

```
docker-compose build
```

To start the services:

```
docker-compose up -d
```

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## Reporting Issues

If you encounter any problems or have suggestions for improvements, please open an issue on GitHub. Follow these steps
to ensure your issue can be addressed efficiently:

1. Go to the [Issues tab](https://github.com/vDoIT-Technologies/sentience-backend/issues) of the repository.

2. Click on "New Issue".

3. Provide a clear and concise title that summarizes the issue.

4. In the issue description, include:

    - A detailed description of the problem or suggestion
    - Steps to reproduce the issue (if applicable)
    - Expected behavior
    - Actual behavior
    - Your environment (OS, Bun version, etc.)

5. If possible, include visual aids:

    - For errors or unexpected behavior, include screenshots:
        - On Windows/Linux: Use the PrtScn key and paste into the issue, or use the Snipping Tool.
        - On Mac: Use Cmd + Shift + 3 for full screen, or Cmd + Shift + 4 for a selection.
    - For more complex issues, consider creating a short screen recording:
        - On Windows: Use the built-in Xbox Game Bar (Win + G) or OBS Studio.
        - On Mac: Use QuickTime Player or Screen Recording (Cmd + Shift + 5).
    - Upload your screenshot or recording directly to the issue or provide a link to it.

6. Tag relevant team members:

    - Use the @ symbol followed by the GitHub username, e.g., @developer-name.
    - If you're unsure who to tag, use @your-username/sentience-team (replace with your actual team name).

7. Add appropriate labels to the issue (e.g., bug, enhancement, question).

8. Before submitting, preview your issue to ensure all information is clear and formatted correctly.

Example issue template:

```
## Description
[Provide a brief description of the issue]

## Steps to Reproduce
1. [First Step]
2. [Second Step]
3. [and so on...]

## Expected Behavior
[What you expect to happen]

## Actual Behavior
[What actually happens]

## Screenshots/Recordings
[If applicable, add screenshots or a link to a screen recording]

## Environment
- OS: [e.g. Windows 10, macOS Big Sur]
- Bun Version: [e.g. 1.0.0]
- Node Version: [e.g. 14.17.0]

## Additional Context
[Add any other context about the problem here]

@relevant-team-member Please take a look at this issue.
```

By following these guidelines, you'll help the team understand and address your issue more quickly and effectively.

## References

- OpenAI for providing the language model API
- Langchain for AI integration utilities()
  [Link](https://js.langchain.com/v0.2/docs/integrations/vectorstores/pgvector/#setup-a-pgvector-self-hosted-instance-with-docker-compose)
- Hono for the web framework [Link](https://hono.dev/docs/getting-started/bun)
- Prisma for the ORM
  ([Link](https://www.prisma.io/docs/getting-started/setup-prisma/start-from-scratch/relational-databases-typescript-postgresql))
