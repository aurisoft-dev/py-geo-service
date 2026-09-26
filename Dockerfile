FROM node:20-alpine

# Directorio de trabajo
WORKDIR /app

# Instalar herramientas de compilación para paquetes nativos (better-sqlite3)
RUN apk add --no-cache python3 make g++

# Copiar archivos de dependencias
COPY package*.json ./

# Instalar dependencias (solo producción)
RUN npm ci --omit=dev

# Copiar el resto del código (incluye la carpeta data/ con el Excel)
COPY . .

# Generar la base de datos geo.db a partir del Excel durante el Build!
# Como geo.db está en .gitignore, Dokploy no la recibe.
# Al correr el ingest aquí, la BD se crea y se hornea dentro de la imagen de Docker,
# quedando lista y optimizada para arrancar súper rápido.
RUN npm run ingest

# Exponer el puerto
EXPOSE 3000

# Comando de inicio
CMD ["npm", "start"]
