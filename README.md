
# Live Service (API-Football + Football-Data)

## Endpoints

### `/stats/matches`
Usa **football-data.org** con tu token gratuito.

Ejemplo:
```
/stats/matches?competition=WC
```

### `/stats/fixtures`
Usa **API-Football** (plan Livescores) para datos en vivo.

Ejemplo:
```
/stats/fixtures?live=all
```

### `/health`
Ping para Render.
