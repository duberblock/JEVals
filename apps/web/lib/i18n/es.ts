export const es = {
  app: {
    title: 'jevals Playground',
    tagline: 'Pegue el JSON. Elija hasta dónde probarlo. Ejecute. Entienda el resultado al instante.',
    // C4 (FASE C): identidad del header del prototipo — sustantivos propios,
    // idénticos en ambos idiomas. FB5 (R40/P32) supedita PARCIALMENTE la
    // regla sin-versión de R36/C4: la marca pasa a ser 'JEVals' (con
    // mayúscula/minúscula reales) y una versión de release REAL (desde
    // package.json, fuente única — lib/version.ts) puede acompañar a
    // '// PLAYGROUND'. Los números de versión inventados o pseudo-OS (la
    // V10.5 del prototipo) SIGUEN PROHIBIDOS (F5/§63: nunca inventar).
    name: 'JEVals',
    badge: '// PLAYGROUND'
  },
  nav: {
    principal: 'Principal',
    investigation: 'Investigación',
    operation: 'Operación',
    history: 'Historial'
  },
  language: {
    label: 'Idioma',
    english: 'Inglés',
    spanish: 'Español'
  },
  pages: {
    principal: {
      title: 'Principal',
      description: 'Ejecute un SystemOneRequest y entienda qué ocurrió.'
    },
    investigation: {
      title: 'Investigación',
      description: 'Explore por qué ocurrió el resultado.'
    },
    operation: {
      title: 'Operación',
      description: 'Verifique si la plataforma funcionó correctamente.'
    },
    history: {
      title: 'Historial',
      description: 'Explore todas las ejecuciones persistidas.'
    }
  },
  principal: {
    requestJson: {
      label: 'JSON de solicitud',
      format: 'Formatear',
      sample: 'Ejemplo',
      copy: 'Copiar',
      copied: 'Copiado'
    },
    validation: {
      title: 'VALIDACIÓN JSON',
      valid: 'VÁLIDO',
      questionsDetected: '{count} PREGUNTAS DETECTADAS',
      questionDetectedOne: '{count} PREGUNTA DETECTADA',
      mobileSummary: '✓ VÁLIDO · {count} PREGUNTAS · {types}',
      mobileSummaryOne: '✓ VÁLIDO · {count} PREGUNTA · {types}',
      detectionSource: 'Fuente de detección: questions[name].type',
      syntaxError: 'Error de sintaxis',
      waiting: 'Pegue un SystemOneRequest para validarlo.',
      checking: 'Validando…',
      unreachableTitle: 'API inaccesible',
      unreachableDetail: 'No se pudo contactar la API de jevals. Intente de nuevo en un momento.',
      close: 'Cerrar'
    },
    // C5 (FASE C): tira de contexto de ejecución bajo el título de la página
    // (tratamiento del subheader del prototipo, vocabulario §15 — F5: nada
    // pseudo-OS). Las etiquetas se guardan en minúscula-oración; la utilidad
    // label-caps las pasa a mayúsculas por CSS. 'Run ID' es el término
    // canónico — idéntico en ambos idiomas.
    contextBar: {
      ariaLabel: 'Contexto de ejecución',
      label: 'Ejecución',
      noActive: 'Sin ejecución activa',
      runId: 'Run ID',
      mode: 'Modo',
      duration: 'Duración',
      providers: 'Proveedores'
    },
    // C8 (FASE C): chips de salud de providers pre-run (extensión §63). Los
    // nombres de provider son sustantivos propios §63 en el componente —
    // idénticos en ambos idiomas; solo estas palabras se localizan.
    providerHealth: {
      label: 'Proveedores',
      ariaLabel: 'Salud de providers',
      available: 'disponible',
      unavailable: 'no disponible',
      unknown: 'desconocido'
    },
    // P30 (FB3): los recientes hidratan Principal. loadedFrom nombra la
    // ejecución desde la que se cargó la superficie (id corto);
    // loadFailedTitle es el respaldo cuando el GET de detalle falla sin un
    // título de dominio; clear etiqueta el botón Limpiar junto a Ejecutar.
    loadedFrom: 'Cargado de ejecución {id}',
    loadFailedTitle: 'No se pudo cargar la ejecución.',
    clear: 'Limpiar',
    // P46 (R61): diccionario del disclosure del bloque de solicitud. El
    // bloque de entrada completo colapsa a una línea de resumen honesta
    // cuando arranca una corrida o aterriza un caso; el título se guarda
    // label-caps (el idiom de panel/titles). El resumen lleva DOS señales
    // ortogonales: la palabra de validez §19.1 VIVA del editor
    // (válida/inválida/validando/vacía) y el marcador de frescura B3
    // "editada" — jamás fundidas en una sola. questions renderiza el conteo
    // vivo detectado (solo con un veredicto válido — nunca inventado). Las
    // palabras de validez van en minúscula-oración a propósito: distintas a
    // simple vista del veredicto en mayúsculas del panel, para que el
    // resumen se lea como su propia señal viva (y jamás se confundan).
    requestBlock: {
      title: 'SOLICITUD',
      expand: 'Expandir solicitud',
      collapse: 'Colapsar solicitud',
      edited: 'editada',
      questions: '{count} preguntas',
      validity: {
        valid: 'Válida',
        invalid: 'Inválida',
        checking: 'Validando…',
        empty: 'Vacía'
      }
    }
  },
  mode: {
    title: 'Modo de ejecución',
    emulator: 'Emulador',
    emulatorHint: 'Ejecución local',
    compare: 'Comparar con JEV',
    compareHint: 'Emulador + JEV real',
    evaluate: 'Evaluar predicción',
    evaluateHint: 'Emulador + JEV real + evaluación IA',
    jevUnavailable: 'JEV no está configurado.',
    llmUnavailable: 'No hay proveedor LLM configurado.'
  },
  advanced: {
    title: 'Avanzado',
    independentLlm: 'Predicción LLM independiente',
    llmUnavailable: 'No hay proveedor LLM configurado.'
  },
  // P47: slice de diccionario de la caja de escenario — compartida por las
  // tres superficies (panel de validación, resultados de Principal, encabezado
  // de Investigación). El título se guarda label-caps (el idiom de
  // panel/titles); copy/copied alimentan el CopyButton de la casa que el idiom
  // PayloadBlock ya entrega.
  scenario: {
    title: 'ESCENARIO',
    view: 'Ver escenario',
    copy: 'Copiar',
    copied: 'Copiado'
  },
  run: {
    execute: 'Ejecutar solicitud',
    running: 'Ejecutando…',
    // P28 (FB1): la transmisión SSE de la corrida terminó sin un frame
    // terminal. La corrida PUEDE completarse igualmente del lado del
    // servidor (blindaje §50 ante desconexiones), así que el texto apunta al
    // Historial en vez de sugerir pérdida — y el cliente NUNCA reintenta
    // solo (un reintento duplicaría ejecuciones).
    streamInterruptedTitle: 'Transmisión interrumpida',
    streamInterruptedDetail:
      'Se perdió la conexión con la API de jevals durante la ejecución. Consulte el Historial antes de volver a ejecutar la solicitud.',
    // P39: etiqueta de la barra de progreso LLM — visible mientras una pata
    // LLM (el Judge o la predicción independiente) sigue en vuelo después
    // de que la comparación determinista ya mostró sus filas.
    llmInProgress: 'Consulta LLM en curso…'
  },
  hero: {
    completed: '✓ Ejecución completada · {count} preguntas',
    completedOne: '✓ Ejecución completada · {count} pregunta',
    failedTitle: 'Ejecución fallida',
    viewInInvestigation: 'Ver en Investigación',
    questions: 'Preguntas',
    duration: 'Duración',
    model: 'Modelo',
    executionId: 'Ejecución',
    matched: '✓ LA PREDICCIÓN COINCIDIÓ CON JEV',
    diverged: '✗ LA PREDICCIÓN DIVERGIÓ DE JEV',
    jevFidelity: 'Fidelidad JEV',
    questionsAligned: '{aligned} / {total} preguntas alineadas',
    questionsAlignedOne: '{aligned} / {total} pregunta alineada',
    jevUnavailable: '✓ Ejecución completada · JEV no disponible',
    jevModel: 'Modelo JEV',
    // §22/§32: vocabulario §67 de semantic_divergence, solo resumen. C10
    // (FASE C): el prefijo nombra la fuente explícitamente (sustantivo
    // propio §15.5, idéntico en ambos idiomas).
    aiDivergence: {
      none: 'Judge: Sin divergencia material',
      minor: 'Judge: Divergencia semántica menor',
      material: 'Judge: Divergencia semántica material',
      undetermined: 'Judge: Indeterminada'
    },
    // §22/§31: la verificación secundaria — una línea desde el booleano
    // global de alineación, familia de redacción del ejemplo del §22.
    independentAligned: 'Independiente: alineada',
    independentDiverged: 'Independiente: divergente',
    // §45.3: sufijo del aria-label cuando la línea de resumen IA enlaza a
    // Investigación (término canónico §15.5).
    // C2 (FASE C): CTA del héroe hacia Investigación (término canónico).
    inspectCta: 'Inspeccionar en Investigación',
    // P41: razón accesible del CTA durante la ejecución — el botón
    // Inspeccionar renderiza deshabilitado (aún no existe un id de ejecución
    // que enlazar); esta línea indica cuándo estará disponible.
    inspectCtaDisabled: 'Disponible cuando finalice la ejecución',
    // C7 (FASE C): etiquetas canónicas de fuente — sustantivos propios
    // (§15.5), idénticas en ambos idiomas.
    sourceLabels: {
      emulator: 'Emulator',
      jev: 'JEV',
      judge: 'Judge',
      independent: 'Independent'
    }
  },
  questions: {
    title: 'Resultados por pregunta',
    confidence: 'Confianza',
    probability: 'P(true)',
    inspect: 'Inspeccionar',
    sameDecision: 'Misma decisión',
    differentDecision: 'Decisión distinta',
    bothBelow: 'Ambas < .5',
    bothAbove: 'Ambas > .5',
    crossed: 'Cruzó .5',
    // §35: etiqueta accesible del enlace por fila a Investigación.
  },
  recent: {
    title: 'Ejecuciones recientes',
    empty: 'Todavía no hay ejecuciones.',
    loading: 'Cargando…',
    failed: 'No se pudieron cargar las ejecuciones recientes.',
    viewInInvestigation: 'Ver en Investigación',
    questionsAligned: '{aligned} / {total} preguntas alineadas',
    questionsAlignedOne: '{aligned} / {total} pregunta alineada',
    // §32: insignia para ejecuciones de evaluación — vocabulario canónico
    // "Evaluación IA" (§15.5) más la palabra de divergencia §67 localizada.
    semanticDivergence: {
      label: 'Evaluación IA',
      none: 'ninguna',
      minor: 'menor',
      material: 'material',
      undetermined: 'indeterminada'
    },
    mode: {
      emulator: 'Emulador',
      compare: 'Comparar con JEV',
      'compare-and-evaluate': 'Evaluar predicción'
    },
    status: {
      completed: 'Completada',
      // Las ejecuciones §66 parciales (una pata falló, el run terminó) se
      // clasifican como Parcial aquí también — mismo railStatus que el riel
      // y el historial.
      partial: 'Parcial',
      failed: 'Fallida'
    },
    // P30 (FB3): verbo del aria-label cuando una fila de ejecuciones recientes
    // hidrata Principal con esa ejecución (misma composición id/modo/estado).
    loadExecution: 'Cargar ejecución',
    viewHistory: 'Ver historial',
    // FB4 (R42/P31): el link del estado vacío hacia /how-it-works — el punto
    // de acceso mobile-friendly (el link del header es solo desktop).
    howItWorks: 'Cómo funciona'
  },
  // FB4 (R42/P31): /how-it-works — el recorrido estático bilingüe del
  // pipeline del evaluador. Nivel producto (no-nerd): sin jerga de
  // transporte, los seis pasos nombran lo que ocurre en cada corrida, y los
  // CTA apuntan a Investigación ("verlo en acción") y Principal ("ejecutar
  // una solicitud"). Los sustantivos propios del dominio (JEV, LLM,
  // Choice/Score/Noul) quedan idénticos en ambos idiomas; el resto localiza.
  howItWorks: {
    title: 'Cómo funciona',
    intro:
      'JEVals evalúa respuestas de IA entre sí y contra el motor real — de forma determinista y con la evidencia preservada. Esta página recorre lo que ocurre en cada ejecución.',
    steps: [
      {
        title: 'La solicitud',
        body: 'Pegue un SystemOneRequest: un estado (la situación, en JSON simple) más las preguntas que desea responder. Cada pregunta tiene un tipo — choice, score o noul.'
      },
      {
        title: 'Validación y detección',
        body: 'Antes de la ejecución, la solicitud se valida y la primitiva de cada pregunta se detecta a partir de su tipo declarado. Verá exactamente qué se va a evaluar — sin sorpresas.'
      },
      {
        title: 'Las fuentes',
        body: 'Quién responde. El Emulador es el servicio local de pruebas. JEV es el motor real de typesafe.ai. LLM alimenta dos roles: la predicción Independiente y el Judge, que revisa todas las respuestas después.'
      },
      {
        title: 'Comparación',
        body: 'Las respuestas se comparan mediante cálculos deterministas: las mismas entradas siempre producen los mismos números. Cada pregunta recibe una puntuación de fidelidad y un veredicto de alineación — la interfaz jamás re-deriva nada.'
      },
      {
        title: 'Evaluación semántica',
        body: 'Más allá de los números, el Judge clasifica cuánto divergen las respuestas en significado: ninguna, menor o material. Es la línea de evaluación de IA que verá en los resultados.'
      },
      {
        title: 'Snapshot e historial',
        body: 'Cada ejecución se persiste como un snapshot inmutable: solicitud, respuestas por fuente, comparación, tiempos. Puede consultar cualquier ejecución en Investigación y Operación — el historial jamás re-ejecuta nada.'
      }
    ],
    modesTitle: 'Modos de ejecución',
    modes: [
      {
        name: 'Emulador',
        description: 'Ejecuta solo el servicio local de pruebas — instantáneo, sin llamadas externas.'
      },
      {
        name: 'Comparar con JEV',
        description: 'Emulador y el motor real lado a lado, con fidelidad por pregunta.'
      },
      {
        name: 'Evaluar predicción',
        description: 'Añade la predicción Independiente de LLM y la evaluación semántica del Judge.'
      }
    ],
    // Sustantivos propios del dominio (§15) — los nombres quedan idénticos en
    // ambos idiomas; solo las descripciones traducen.
    primitivesTitle: 'Tipos de pregunta',
    primitives: [
      {
        name: 'Choice',
        description: 'Elegir una opción de una lista fija.'
      },
      {
        name: 'Score',
        description: 'Calificar en una escala ordenada.'
      },
      {
        name: 'Noul',
        description: 'Estimar la probabilidad de un enunciado.'
      }
    ],
    fidelityTitle: '¿Qué es la fidelidad?',
    fidelityBody:
      'Una medida de similitud de 0 a 100% por pregunta — qué tan cerca están las respuestas según el tipo de la pregunta; el número global es el promedio de las preguntas. Se computa de forma determinista: ningún modelo juzga el cálculo.',
    promptHelpTrigger: 'Prompt de ayuda',
    promptHelpIntro:
      'Pega este prompt en cualquier LLM junto con tu conversación, documento o contexto: construye un SystemOneRequest válido, listo para ejecutar aquí.',
    promptCopy: 'Copiar prompt',
    promptCopied: 'Copiado',
    seeItInAction: 'Verlo en acción',
    runARequest: 'Ejecutar una solicitud',
    // R50: atribución del autor — fuente única author.md (canon R06). La
    // identidad es el branding propio del autor y queda verbatim en AMBOS
    // locales (precedente §15 de proper nouns); solo el label se localiza.
    authorLabel: 'Autor',
    authorName: 'Duber López (@duberblock)',
    authorRole: 'AI Solutions Architect | Enterprise Technology Leader',
    // R52: la fila completa de redes de author.md — nombres de sitio son
    // sustantivos propios, idénticos en ambos locales. El link del nombre
    // de arriba ES el sitio web; esta fila lleva las demás redes.
    authorBlog: 'Blog',
    authorLinktree: 'Linktree',
    authorLinkedIn: 'LinkedIn',
    authorX: 'X (Twitter)',
    authorYouTube: 'YouTube',
    authorInstagram: 'Instagram'
  },
  // Operación (plan §54.2, §60-§61.7). Esta superficie responde SOLO "¿La
  // plataforma funcionó correctamente?" — las métricas semánticas nunca
  // aparecen acá (§70). Terminología §15.5: Completada/Fallida/Parcial.
  operation: {
    loading: 'Cargando…',
    loadFailed: 'No se pudo cargar la ejecución.',
    listLoading: 'Cargando…',
    listLoadFailed: 'No se pudieron cargar las ejecuciones.',
    emptyHistory: 'Aún no hay ejecuciones.',
    status: {
      completed: 'Completada',
      failed: 'Fallida',
      partial: 'Parcial'
    },
    mode: {
      emulator: 'Emulador',
      compare: 'Comparar con JEV',
      'compare-and-evaluate': 'Evaluar predicción'
    },
    rail: {
      title: 'EJECUCIONES ANTERIORES',
      searchLabel: 'Buscar ejecuciones',
      searchPlaceholder: 'Buscar…',
      rangeAll: 'Todas',
      rangeToday: 'Hoy',
      range7d: '7 días',
      range30d: '30 días',
      statusAll: 'Todas',
      empty: 'Ninguna ejecución coincide con los filtros actuales.',
      viewMore: 'Ver más ejecuciones',
      questionCount: '{count}p'
    },
    // §61 encabezado central: Ejecución #<shortId>.
    executionHeading: 'Ejecución #{id}',
    summary: {
      status: 'Estado',
      totalTime: 'Tiempo total',
      questions: 'Preguntas',
      questionsValue: '{processed} / {total} procesadas',
      providers: 'Proveedores',
      providersValue: '{completed} / {total} completados',
      aiEvaluation: 'Evaluación IA',
      persistence: 'Persistencia',
      ok: 'OK',
      aiValue: {
        success: 'éxito',
        failed: 'fallida',
        notRun: 'no se ejecutó'
      }
    },
    components: {
      request_validation: 'Validación de solicitud',
      emulator: 'Emulador',
      jev: 'JEV',
      independent_openai: 'LLM independiente',
      // Vocabulario de la clave §47 ("comparison"): la métrica semántica
      // "Fidelidad JEV" (§60) nunca aparece en esta superficie (§70).
      fidelity: 'Comparación',
      ai_judge: 'Judge IA',
      persistence: 'Persistencia'
    },
    flow: {
      title: 'Flujo de ejecución',
      parallel: 'paralelo'
    },
    latency: {
      title: 'Tiempo por componente',
      notRecorded: 'No se registró para esta ejecución.'
    },
    logs: {
      title: 'Logs',
      openLabel: 'Ver logs',
      executionComponent: 'Ejecución'
    },
    info: {
      title: 'INFORMACIÓN',
      executionId: 'ID de ejecución',
      requestHash: 'Hash de solicitud',
      mode: 'Modo',
      models: 'Modelos',
      created: 'Creada',
      actions: 'Acciones',
      viewInInvestigation: 'Ver en Investigación',
      download: 'Descargar ejecución',
      copy: 'Copiar',
      copied: 'Copiado'
    },
    mobile: {
      selectExecution: 'Ejecución #{id}',
      // Copia neutral del disparador cuando no se conoce un id de ejecución
      // (la carga de detalle falló antes de llegar un snapshot): el
      // navegador sigue accesible.
      selectExecutionFallback: 'Seleccionar ejecución',
      drawerTitle: 'Ejecuciones anteriores',
      currentExecution: 'EJECUCIÓN ACTUAL',
      previousExecutions: 'EJECUCIONES ANTERIORES',
      close: 'Cerrar'
    }
  },
  // Historial (§55): la tabla completa de ejecuciones. Columnas con la
  // prioridad de Operación — las métricas semánticas son secundarias.
  history: {
    execution: 'Ejecución',
    created: 'Creada',
    status: 'Estado',
    duration: 'Duración',
    mode: 'Modo',
    questionCount: 'Preguntas',
    fidelity: 'Fidelidad',
    aligned: 'Alineadas',
    alignedValue: '{aligned} / {total}',
    loadMore: 'Cargar más',
    loadingMore: 'Cargando…',
    empty: 'Todavía no hay ejecuciones.',
    loadFailed: 'No se pudieron cargar las ejecuciones.'
  },
  theme: {
    toggle: 'Cambiar tema',
    light: 'Claro',
    dark: 'Oscuro'
  },
  // Investigación (plan §34-§45.7). Terminología canónica §15.5:
  // ¿Por qué este resultado? / Evidencia / Evaluación IA / Verificación
  // independiente. Las plantillas deterministas (§39) las redacta la app,
  // nunca las palabras de la IA.
  investigation: {
    loading: 'Cargando…',
    loadFailed: 'No se pudo cargar la ejecución.',
    notFoundTitle: 'Ejecución no encontrada',
    notFoundDetail: 'Esta ejecución no existe o ya no está disponible.',
    missingExecutionTitle: 'Ninguna ejecución seleccionada',
    missingExecutionDetail: 'Abra un resultado en Principal y elija Ver en Investigación.',
    noQuestions: 'Esta ejecución no tiene preguntas para investigar.',
    whyTab: 'POR QUÉ',
    evidenceTab: 'EVIDENCIA',
    whyTitle: '¿POR QUÉ ESTE RESULTADO?',
    viewEvidence: 'VER EVIDENCIA',
    // P34 (FB7): enlace de la tira global hacia Principal hidratado
    // (/?execution=<id>) — nombre canónico §15.4 de la superficie.
    viewInPrincipal: 'Ver en Principal',
    emulatorLabel: 'Emulador',
    emulatorAnswerLabel: 'Respuesta del emulador',
    jevLabel: 'JEV',
    probabilityLabel: 'P(true)',
    whyHeading: '¿POR QUÉ?',
    emulatorOnlyNote: 'Ejecución solo emulador: la comparación con JEV no aplica.',
    // §66: una comparación cuyo JEV falló no es "solo emulador" — la nota
    // dice que no hay comparación porque el JEV falló.
    jevFailedNote: 'Falló el JEV — no hay comparación disponible.',
    sameDecision: '✓ MISMA DECISIÓN',
    differentDecision: '! DECISIÓN DISTINTA',
    sameLevel: '✓ MISMO NIVEL: {level}',
    differentLevel: '! NIVEL DISTINTO',
    bothBelow: '✓ AMBAS < .5',
    bothAbove: '✓ AMBAS > .5',
    crossed: '! CRUZÓ .5',
    // P38/FB11 §30/§39: ampliación de vocabulario — el veredicto Noul es
    // COMPUESTO: geometría §27 (frases sin marcador) + resultado (dirección).
    // 0.5 es ÚNICAMENTE el punto medio matemático: las frases jamás nombran
    // un lado para una probabilidad EN .5; su dirección es honestamente
    // indefinida. Las frases marcadas de arriba quedan para snapshots pre-P38.
    noulGeometryBothBelow: 'AMBAS < .5',
    noulGeometryBothAbove: 'AMBAS > .5',
    noulGeometryCrossed: 'CRUZÓ .5',
    noulGeometryBothAt: 'AMBAS EN .5',
    noulGeometryAtAndBelow: 'UNA EN .5, OTRA < .5',
    noulGeometryAtAndAbove: 'UNA EN .5, OTRA > .5',
    noulDirectionSame: 'misma dirección',
    noulDirectionOpposite: 'direcciones opuestas',
    noulDirectionMidpointUndefined: 'punto medio: dirección indefinida',
    whyChoiceAligned: 'Ambos sistemas identifican la solicitud como {value}.',
    whyChoiceDiverged: 'Las fuentes asignan resultados categóricos distintos.',
    whyScoreAligned: 'Ambos valores permanecen en el mismo nivel de rúbrica.',
    whyScoreDiverged: 'La diferencia numérica cambia el nivel de rúbrica resultante.',
    whyNoulAligned: 'Las probabilidades permanecen del mismo lado del punto medio de probabilidad.',
    whyNoulDiverged: 'Las probabilidades quedan en lados opuestos del punto medio de probabilidad.',
    // P38/FB11: las plantillas del veredicto compuesto (las legacy de arriba quedan).
    whyNoulSameDirection:
      'Ambas probabilidades quedan del mismo lado del punto medio de probabilidad — misma dirección.',
    whyNoulOppositeDirections:
      'Las probabilidades quedan en lados opuestos del punto medio de probabilidad — direcciones opuestas.',
    whyNoulMidpointUndefined:
      'Una probabilidad está exactamente en el punto medio matemático 0.5 — dirección indefinida.',
    rubricLabel: 'Rúbrica: {levels}',
    rubricSelected: 'Seleccionado: {selected}',
    criteriaLabel: 'Criterios: {criteria}',
    criteriaSelected: 'Seleccionado: {selected}',
    viewRubric: 'Ver rúbrica >',
    viewCriteria: 'Ver criterios >',
    // §33/ADR-013 fallo 3: etiqueta del desglose de distribuciones (B2) —
    // las barras de probabilidad completas quedan a un toque (§38).
    viewProbabilities: 'Ver probabilidades',
    // §33/ADR-013 fallo 5: etiqueta corta del Independiente en gráficos (A7).
    independentShort: 'LLM',
    close: 'Cerrar',
    aiTitle: 'EVALUACIÓN IA',
    viewAiReasoning: 'Ver razonamiento de la IA',
    aiUnavailable: 'La evaluación IA no está disponible para esta ejecución.',
    // §45.7 pregunta 4: las ejecuciones sin evaluación IA lo dicen
    // explícitamente — "no se ejecutó" nombra el modo y nunca implica fallo.
    aiNotRun: 'Evaluación IA: no se ejecutó ({mode})',
    // Etiquetas de modo localizadas para esa línea (los enums crudos nunca
    // llegan a la UI, plan 15.5).
    modeLabels: {
      emulator: 'Emulador',
      compare: 'Comparar con JEV',
      'compare-and-evaluate': 'Evaluar predicción'
    },
    aiOverallLabel: 'General',
    aiPredictionQuality: 'Calidad de predicción',
    aiSemanticDivergence: 'Divergencia semántica',
    aiEmulatorSupport: 'Soporte del emulador',
    aiJevSupport: 'Soporte JEV',
    aiPreferred: 'Preferido',
    aiReason: 'Razón',
    aiDivergence: {
      none: 'Sin divergencia',
      minor: 'Divergencia menor',
      material: 'Divergencia material',
      undetermined: 'Divergencia indeterminada'
    },
    aiPreferredWord: {
      emulator: 'Emulador',
      jev: 'JEV',
      tie: 'Empate',
      undetermined: 'Indeterminado'
    },
    independentTitle: 'VERIFICACIÓN INDEPENDIENTE',
    independentUnavailable: 'La verificación independiente no está disponible para esta ejecución.',
    agreesBoth: '✓ coincide con ambos',
    differsBoth: '! difiere del Emulador/JEV',
    differsJev: '! difiere del JEV',
    differsEmulator: '! difiere del Emulador',
    agreesEmulatorOnly: '✓ coincide con el emulador',
    differsEmulatorOnly: '! difiere del emulador',
    sourceLabel: 'Fuente',
    sources: {
      request: 'Solicitud',
      emulator: 'Emulador',
      jev: 'JEV',
      ai: 'Evaluación IA',
      independent: 'LLM independiente',
      full: 'Ejecución completa'
    },
    titles: {
      request: 'SOLICITUD SYSTEM ONE',
      emulator: 'RESPUESTA DEL EMULADOR',
      jev: 'RESPUESTA JEV',
      ai: 'EVALUACIÓN IA',
      independent: 'LLM INDEPENDIENTE',
      full: 'EJECUCIÓN COMPLETA'
    },
    inputTitle: 'ENTRADA',
    inputCaption: 'Solo la solicitud original',
    outputTitle: 'SALIDA',
    outputCaption: 'Predicción estructurada',
    // P37/FB10: caption del payload run-wide del emulador — solo ejecuciones solo-emulador.
    emulatorEvidenceCaption: 'La respuesta del emulador de esta ejecución',
    sourceUnavailable: 'Esta ejecución no produjo esta sección.',
    // §45: las instantáneas antiguas pueden carecer de campos opcionales de
    // evidencia — los campos ausentes muestran este marcador honesto (nunca
    // "undefined").
    notRecorded: 'No se registró para esta ejecución.',
    structuredJudgeOutput: 'Salida estructurada del Judge',
    viewFullLlmExchange: 'Ver intercambio LLM completo',
    llmExchangesTitle: 'INTERCAMBIOS LLM',
    attemptLabel: 'Intento {index}',
    copyRequest: 'Copiar solicitud',
    copyResponse: 'Copiar respuesta',
    copyEvaluation: 'Copiar evaluación',
    copyInput: 'Copiar entrada',
    copyOutput: 'Copiar salida',
    copyExecutionBundle: 'Copiar paquete de ejecución',
    copyAnalysisBundle: 'Copiar paquete de análisis',
    copied: 'Copiado',
    download: 'Descargar',
    llm: {
      configuration: 'Configuración',
      systemInstruction: 'Instrucción del sistema',
      llmInput: 'Entrada LLM',
      outputSchema: 'Esquema de salida',
      rawResponse: 'Respuesta sin procesar del modelo',
      parsedResult: 'Resultado analizado de la aplicación',
      copyConfiguration: 'Copiar configuración',
      copySystemInstruction: 'Copiar instrucción del sistema',
      copyLlmInput: 'Copiar entrada LLM',
      copySchema: 'Copiar esquema',
      copyRawResponse: 'Copiar respuesta sin procesar',
      copyParsedResult: 'Copiar resultado analizado',
      copyFullExchange: 'Copiar intercambio completo'
    },
    find: {
      label: 'Buscar',
      matches: '{count} coincidencias',
      matchesOne: '{count} coincidencia',
      noMatches: 'Sin coincidencias'
    }
  },
  units: {
    milliseconds: 'ms',
    // P42: sufijo del tiempo transcurrido de la barra de progreso — un
    // símbolo de unidad, idéntico byte a byte en ambos locales por diseño
    // (jamás una palabra traducida).
    seconds: 's'
  },

  // Configuración de proveedores (UI): las cuatro tarjetas — endpoint,
  // modelo y API key (cifrada en reposo) por proveedor, guardadas vía
  // /api/v1/settings. El texto plano de una key jamás regresa del API; la
  // UI solo sabe si hay una guardada.
  settings: {
    headerTitle: 'Configuración',
    title: 'Configuración de proveedores',
    subtitle:
      'Configura los servicios que JEVals utilizará para ejecutar, comparar y evaluar predicciones. Para empezar puedes usar los valores actuales; cambia una configuración solo si quieres probar otro modelo, usar otra referencia o ejecutar Judge e Independiente con otro proveedor compatible.',
    concept:
      'Emulador es el modelo que pruebas. JEV es la referencia. Judge interpreta las diferencias. Predicción independiente aporta una tercera respuesta a ciegas.',
    keysNote: 'Las API keys se almacenan cifradas. Si dejas una key vacía al guardar, se conserva la que ya está almacenada.',
    save: 'Guardar',
    saving: 'Guardando…',
    saved: 'Guardado',
    clearKey: 'Borrar la key guardada',
    keyCleared: 'Key borrada',
    endpoint: 'Endpoint',
    model: 'Modelo',
    apiKey: 'API key',
    keySetHere: 'Hay una key guardada aquí (cifrada en reposo)',
    keySetEnv: 'Hay una key configurada en el entorno',
    keyNotSet: 'Sin key configurada',
    fromEnv: 'entorno',
    fromDefault: 'predeterminado',
    fromUi: 'configurado aquí',
    configuredHere: 'configurado aquí',
    sourceLine: 'Configuración',
    presetDefault: 'SystemOne predeterminado',
    presetDemo: 'Demo público Simple Jev',
    presetCustom: 'Endpoint propio',
    available: 'Disponible',
    unavailable: 'No disponible',
    loadError: 'No se pudo cargar la configuración.',
    saveError: 'No se pudo guardar. Revisa el endpoint e intenta de nuevo.',
    copyJudge: 'Usar configuración del Judge',
    copyJudgeDone: 'Configuración del Judge aplicada',
    copyJudgeError: 'El Judge aún no tiene configuración que copiar.',
    structuredOutputs: 'Usar JSON Schema nativo',
    structuredOutputsHint:
      'Actívalo cuando el endpoint y el modelo soporten JSON Schema estricto de forma nativa (OpenAI, Ollama). Desactívalo para z.ai/GLM o si la pestaña Evidencia muestra que siempre termina en modo por prompt — la estructura requerida viaja dentro del prompt.',
    guideLinks: {
      emulator: '¿Qué puedo probar aquí?',
      jev: '¿Qué puedo usar como referencia?',
      judge: '¿Cómo funciona el Judge?',
      independent: '¿Por qué es independiente?'
    },
    help: {
      emulator:
        '¿Qué configura esta caja?\nEl Emulador es el modelo bajo prueba: JEVals envía aquí el SystemOneRequest y usa su respuesta como la predicción que será evaluada. Participa en todos los modos (Emulador, Comparar con JEV, Evaluar predicción); la Predicción independiente, si la activas, corre en paralelo.\n\n¿Qué servicios puedo conectar?\nSystemOne — …/v1/systemone. El predeterminado es https://jevs-jimmy.blockito.cloud/v1/systemone (documentación: https://jevs-jimmy.blockito.cloud/SKILL.md).\nSimple Jev — …/v1/classifier. Demo público: https://simple-jev.featherless.ai/ (documentación: https://simple-jev.featherless.ai/skills.md).\n\n¿Qué opción debo elegir?\nSystemOne predeterminado: sin API key y el modelo lo decide el propio endpoint.\nDemo público Simple Jev: prueba JEVals rápido con un classifier público, sin key.\nEndpoint propio: para evaluar otro modelo o una implementación compatible con /v1/systemone o /v1/classifier.\n\n¿Qué representa en los resultados?\nEs la predicción bajo prueba; cuando hay comparación aparece a la izquierda: Emulador → JEV.\n\nResumen: Emulador = el modelo que estás probando.',
      jev:
        '¿Qué configura esta caja?\nDefine contra qué modelo quieres comparar el Emulador. JEVals envía exactamente el mismo request al modelo bajo prueba y al configurado aquí, y compara ambas respuestas pregunta por pregunta de forma determinista (fidelidad, alineación, diferencias).\n\nConfiguración predeterminada\nJEV de typesafe.ai — endpoint https://api.typesafe.ai · modelo jev-latest (vacío lo usa) · documentación: https://github.com/typesafe-ai/skills/blob/main/skills/typesafe-ai/SKILL.md. Es la recomendada cuando quieres medir qué tan fiel es otro modelo respecto a JEV.\n\n¿Puedo usar otra referencia?\nSí, cualquier servicio compatible: otro SystemOne (p. ej. https://jevs-jimmy.blockito.cloud/v1/systemone — https://jevs-jimmy.blockito.cloud/SKILL.md) o un Simple Jev (…/v1/classifier — https://simple-jev.featherless.ai/skills.md).\n\n¿Qué significa cambiar la referencia?\nLa fidelidad mide qué tan alineada está la respuesta del Emulador con la referencia configurada aquí. Cambiar esta caja cambia el marco con el que se mide.\n\n¿Cuándo se utiliza?\nEn Comparar con JEV y Evaluar predicción; no en modo Emulador.\n\n¿Qué representa en los resultados?\nLa referencia aparece a la derecha: Emulador → JEV.\n\nResumen: JEV de referencia = el modelo contra el que estás comparando.',
      judge:
        '¿Qué configura esta caja?\nEl Judge interpreta las diferencias entre el Emulador y la referencia; no calcula la fidelidad (eso lo hace JEVals de forma determinista). Recibe únicamente el request original, la respuesta del Emulador, la del JEV y la comparación — nunca ve la Predicción independiente. Solo participa en Evaluar predicción.\n\nConfiguración predeterminada\nEndpoint https://api.openai.com/v1 · modelo gpt-5-nano · JSON Schema nativo activado. Equivalente en variables:\nJUDGE_API_KEY=<tu key> · JUDGE_BASE_URL=https://api.openai.com/v1 · JUDGE_MODEL=gpt-5-nano · OPENAI_STRUCTURED_OUTPUTS=true\n\n¿Puedo usar otro proveedor?\nSí, cualquier endpoint OpenAI Chat Completions. Probado: OpenAI (gpt-5-nano — schema nativo sí), z.ai (glm-5.3 — no; https://api.z.ai/api/coding/paas/v4 o https://api.z.ai/api/paas/v4), Ollama local (qwen3:8b — sí, http://localhost:11434/v1) y Ollama Cloud (deepseek-v4-pro:cloud — sí, https://ollama.com/v1). La tabla al final de la página resume todas.\n\n¿Cuándo activar "Usar JSON Schema nativo"?\nActívalo cuando el endpoint y el modelo soporten json_schema estricto. Si la pestaña Evidencia muestra que el Judge siempre termina en prompted (la secuencia es strict → guided → prompted), desactívalo: la estructura viaja en el prompt y te ahorras intentos fallidos. Con z.ai/GLM desactívalo.\n\nResumen: Judge = el modelo que interpreta las diferencias entre el modelo bajo prueba y la referencia.',
      independent:
        '¿Qué configura esta caja?\nLa Predicción independiente genera una tercera respuesta a ciegas: recibe las mismas preguntas pero solo conoce el request original — nunca ve las respuestas del Emulador, del JEV, la comparación ni la evaluación del Judge.\n\n¿Para qué sirve?\nDespués de responder, JEVals comprueba si su respuesta se alinea o diverge de los demás resultados ejecutados. Si Emulador y JEV dicen A y la independiente dice B, aporta una señal distinta al consenso. Es opcional y puede activarse en cualquier modo.\n\nConfiguración\nUsa la misma clase de integración OpenAI-compatible que el Judge — sirven las mismas configuraciones probadas (tabla al final de la página). "Usar configuración del Judge" copia endpoint, modelo, key y JSON Schema; las ejecuciones siguen siendo independientes porque cada componente recibe un contexto distinto. La independencia no depende de usar otro proveedor o modelo distinto.\n\nJSON Schema nativo\nLa misma regla del Judge. Si la pestaña Evidencia muestra retry_reasons: malformed_structure de forma recurrente, desactívalo para evitar el reintento.\n\nResumen: Predicción independiente = una tercera respuesta generada sin conocer las respuestas que está verificando.'
    },
    providers: {
      emulator: {
        name: 'Emulador',
        description:
          'El modelo que quieres poner a prueba. JEVals envía aquí el request y usa su respuesta como la predicción que será evaluada.',
        endpointHint: 'URL completa del servicio que ejecutará el modelo bajo prueba — …/v1/systemone o …/v1/classifier.',
        modelHint: 'Solo para endpoints que permiten elegir modelo (Simple Jev). En el SystemOne predeterminado lo decide el endpoint.',
        keyHint: 'Solo si tu endpoint exige autenticación; el servicio predeterminado funciona sin key.',
        demoEndpoint: 'https://simple-jev-demo-api.featherless.ai/v1/classifier',
        useDemo: 'Usar el demo público'
      },
      jev: {
        name: 'JEV de referencia',
        description:
          'La referencia contra la que se compara el Emulador. Por defecto es JEV de typesafe.ai; también puedes usar otro servicio SystemOne o Simple Jev.',
        endpointHint: 'Endpoint del modelo que usarás como referencia — https://api.typesafe.ai u otro servicio compatible.',
        modelHint: 'Con https://api.typesafe.ai, si queda vacío se usa jev-latest.',
        keyHint: 'Requerida; si dejas el campo vacío al guardar, se conserva la almacenada.'
      },
      judge: {
        name: 'Judge',
        description:
          'Evalúa las diferencias entre el Emulador y la referencia. Solo se usa en Evaluar predicción.',
        endpointHint: 'Endpoint OpenAI Chat Completions — probado con OpenAI, z.ai, Ollama local y Ollama Cloud.',
        modelHint: 'El modelo que evaluará las divergencias; puede ser cualquiera que sirva tu proveedor.'
      },
      independent: {
        name: 'Predicción independiente',
        description:
          'Una tercera predicción que responde a ciegas: solo ve el request original. Opcional en cualquier modo.',
        endpointHint: 'Endpoint OpenAI Chat Completions — probado con OpenAI, z.ai, Ollama local y Ollama Cloud.',
        modelHint: 'Puede ser el mismo modelo del Judge u otro distinto.'
      }
    },
    compat: {
      title: 'Proveedores OpenAI-compatible probados',
      intro: 'Judge y Predicción independiente pueden usar cualquier endpoint compatible con OpenAI Chat Completions. Estas configuraciones han sido probadas con JEVals:',
      provider: 'Proveedor',
      endpoint: 'Endpoint',
      model: 'Modelo probado',
      native: 'JSON Schema nativo',
      note:
        '"Compatible con OpenAI" describe el contrato de API, no el proveedor — puede ser OpenAI, z.ai, Ollama u otro servicio compatible.',
      rows: [
        ['OpenAI', 'https://api.openai.com/v1', 'gpt-5-nano', 'Sí'],
        ['z.ai Coding Plan', 'https://api.z.ai/api/coding/paas/v4', 'glm-5.3', 'No'],
        ['z.ai por consumo', 'https://api.z.ai/api/paas/v4', 'glm-5.3', 'No'],
        ['Ollama local', 'http://localhost:11434/v1', 'qwen3:8b', 'Sí'],
        ['Ollama Cloud', 'https://ollama.com/v1', 'deepseek-v4-pro:cloud', 'Sí']
      ]
    }
  },
}
