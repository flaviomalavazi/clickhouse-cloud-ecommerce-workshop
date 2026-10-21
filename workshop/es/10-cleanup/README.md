# Módulo 10: Limpieza

**Objetivo:** eliminar todo lo que creó el taller, en local y en la nube, para que nada siga funcionando ni costando dinero.

**Tiempo:** unos 10 minutos. `make down` tarda 10 s.

**Aprenderás:** qué depende de qué y, por lo tanto, en qué orden eliminarlo.

## Antes de empezar

Terminaste los demás módulos, o vas a detenerte aquí.

## Pasos

### 1. Detén la carga y elimina el clúster local

```bash
make traffic-stop      # optional: stops the generators and the simulator
make down
```

`make down` elimina el clúster de k3d: los tres contenedores de nodo y el balanceador de carga, su red y su volumen, y todo lo que se ejecutaba dentro de ellos. No se toca nada en la nube y tus imágenes de Docker se conservan (son lo que hace que el próximo inicio tarde dos minutos en lugar de diez). Bórralas también si quieres recuperar el espacio en disco: `docker image prune -a` elimina todas las imágenes sin usar, así que úsalo solo si nada más de lo tuyo las necesita.

### 2. Elimina los servicios en la nube, en este orden

En la consola de ClickHouse Cloud:

1. **Elimina primero el ClickPipe.** Mantiene un slot de replicación (un marcador que Postgres guarda para el ClickPipe) y una conexión con tu instancia de Postgres. Si la instancia se elimina primero, el ClickPipe queda apuntando a la nada.
2. **Elimina la instancia de Managed Postgres.**
3. **Detén y luego elimina el servicio de ClickHouse.** Las fuentes y la conexión de ClickStack se van con él.
4. **Elimina la clave de API** que creaste en el módulo 01 (la página **API keys** de la organización). Tiene el rol Admin y sobreviviría a tu `.env`. (Si creaste un agente en el módulo 09, elimínalo también desde el Agent Builder. Si hiciste el [paso opcional de Langfuse](../09-clickhouse-agents/langfuse.md), elimina el proyecto de Langfuse, o al menos sus claves de API, y quita los ajustes de Langfuse de ClickHouse Agents: contienen tus conversaciones y una clave secreta.)

### 3. Borra tus credenciales de esta computadora

Tu `.env` contiene las dos contraseñas y `assets/certs/` contiene el certificado de Postgres; git ignora ambos, y ya no se necesita ninguno:

```bash
rm .env assets/certs/*.pem
```

## Punto de control

```bash
make check-10
```

No queda ningún contenedor, red ni volumen `k3d-clickshop`, y el kubeconfig local ya no existe. (La comprobación no puede ver la nube: mira la consola y confirma que los tres servicios ya no están.)

## Solución de problemas

| Síntoma | Solución |
|---|---|
| `make down` dice que el clúster no existe | Ya no está: no hay nada que hacer. |
| `check-10` encuentra contenedores | Ejecuta `make down` otra vez; si Docker se reinició entretanto, `docker ps -a --filter name=k3d` muestra lo que queda. |
| La consola no permite eliminar la instancia de Postgres | Elimina primero su ClickPipe. |

**Así termina el taller.** Si quieres hacerlo de nuevo, empieza en el [módulo 01](../01-cloud-services/README.md) (el módulo 00 otra vez solo si eliminaste las imágenes de Docker).
