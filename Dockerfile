FROM node:20-alpine

# Directorio de trabajo
WORKDIR /app

# Instalar herramientas de compilación para paquetes nativos (better-sqlite3)
RUN apk add --no-cache python3 make g++

# Copiar archivos de dependencias
COPY package*.json ./

# Instalar dependencias (solo producción)
RUN npm ci --omit=dev

# Copiar el resto del código (incluye data/geo.json y el panel web public/)
COPY . .

# Configurar la variable de entorno para forzar a la app a usar este puerto
ENV PORT=3001

# Exponer el puerto
EXPOSE 3001

# Comando de inicio
CMD ["npm", "start"]
