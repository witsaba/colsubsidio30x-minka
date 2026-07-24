# **📝 Las notas**

jul 23, 2026

## **Let's define the flow and tech**

Invitado [adriana.durandc@gmail.com](mailto:adriana.durandc@gmail.com) [edith.lavado04@gmail.com](mailto:edith.lavado04@gmail.com) [danielrosas.business@gmail.com](mailto:danielrosas.business@gmail.com) [Braejan David Arias Heregua](mailto:braejan@witsaba.com)

Archivos adjuntos [Let's define the flow and tech](https://calendar.google.com/calendar/event?eid=NWc4NjQzb2xjcWxoN3JzdWdjczIxaHZoMjAgYnJhZWphbkB3aXRzYWJhLmNvbQ)

Registros de la reunión [Transcripción](https://docs.google.com/document/d/1F2Vw2INXE4I-7hKyX1cNdXg4R07_i9X6FYqpsIpgaJY/edit?usp=drive_web&tab=t.objpqjcl3jic) 

### **Resumen**

Se consolidó la arquitectura técnica enfocada en reconocimiento de voz para optimizar la precisión operativa del inventario.

**Arquitectura de roles definidos**  
La solución separa funciones mediante una aplicación móvil para operarios y una plataforma web para auditores. Se priorizó un sistema autónomo capaz de importar archivos Excel para garantizar viabilidad operativa.

**Estrategia de procesamiento técnico**  
El equipo optó por el modelo push-to-talk para maximizar la fiabilidad y evitar complicaciones del procesamiento en tiempo real. Se implementó validación cruzada con 3 modelos de inteligencia artificial para reducir errores.

**Gestión de errores operacionales**  
Las correcciones se realizarán eliminando y regrabando registros para evitar errores de alucinación de la inteligencia artificial. Se integró una validación asíncrona mediante alertas para mantener la continuidad del flujo de trabajo.

### **Próximos pasos**

- [ ] \[Braejan David Arias Heregua\] Clarificar flujo: Reunirse con la gerente para resolver dudas sobre los flujos de auditoria y los roles de usuario.

- [ ] \[Adriana Durand Calle\] Investigar legalidad voz: Analizar las implicaciones legales y los riesgos de privacidad relacionados con el almacenamiento de archivos de audio.

- [ ] \[El grupo\] Planificar seguridad: Definir protocolos de seguridad bajo la norma ISO 27001 para la presentación final del proyecto.

- [ ] \[El grupo\] Crear gestor datos: Implementar módulos de administracion de usuarios y de carga de archivos Excel para la base de datos.

- [ ] \[Braejan David Arias Heregua\] Compartir documento: Localizar y compartir el documento Discovery consolidado con el resto del equipo.

- [ ] \[Daniel Enrique Rosas Esteban\] Consultar Grupo WhatsApp: Publicar la consulta sobre el proceso de identificacion de productos en el grupo de WhatsApp de hoteleria para obtener informacion de los usuarios actuales.

- [ ] \[Braejan David Arias Heregua\] Consultar Gerente: Preguntar a la gerente del proyecto sobre la jerarquia entre auditores y operadores y la gestion de productos vencidos o eliminados del inventario.

- [ ] \[Braejan David Arias Heregua\] Transferir Datos Supabase: Migrar la estructura de los datos de inventario a Supabase para verificar la visualizacion y funcionalidad del sistema.

- [ ] \[Braejan David Arias Heregua\] Resumir acuerdos: Recopilar los puntos clave y acuerdos alcanzados durante la reunión para compartirlos con el equipo.

- [ ] \[Braejan David Arias Heregua\] Notificar WhatsApp: Publicar la información resumen de la reunión en el grupo de WhatsApp.

- [ ] \[Daniel Enrique Rosas Esteban\] Subir archivos: Cargar los documentos y recursos relevantes discutidos durante la sesión en la carpeta compartida.

- [ ] \[Adriana Durand Calle, Edit\] Documentar producto: Elaborar los documentos iniciales de producto, requerimientos técnicos funcionales, no funcionales y casos de uso.

- [ ] \[El grupo\] Reunión PRD: Reunirse mañana a las 2 PM para revisar y aprobar el documento de requerimientos de producto.

### **Detalles**

* **Problemas técnicos y sistemas operativos**: Braejan David Arias Heregua comparte sus dificultades técnicas con un equipo Mac antiguo, lo que les llevó a instalar Linux, un sistema operativo ligero y compatible, para poder continuar con sus tareas.

* **Acceso a herramientas de IA**: Adriana Durand Calle y Braejan David Arias Heregua discuten sobre el uso de diversas herramientas de inteligencia artificial como Houston AI, Lovable y Gemini. Mencionan que el acceso a ciertas funciones está limitado a planes pro o business ([00:02:53](#00:02:53)). Además, Braejan David Arias Heregua expresa preocupación por la dependencia de plataformas específicas, tras haber experimentado bloqueos previos en servicios como Claude ([00:06:02](#00:06:02)).

* **Flujo de trabajo para inventario por voz**: Adriana Durand Calle presenta una propuesta para un sistema de inventario basado en reconocimiento de voz. El flujo incluye una confirmación verbal de los datos que permite verificar la información contra la base de datos de inventario existente para evitar sesgos ([00:08:00](#00:08:00)). Se determina que el sistema generará un archivo descargable compatible con el sistema principal del cliente y se concluye que no existen riesgos legales significativos por el tratamiento de la voz, dado que esta no se almacenará ([00:09:42](#00:09:42)).

* **Alcance de las pruebas técnicas**: El grupo debate sobre la inclusión de reconocimiento de imágenes (OCR). Daniel Enrique Rosas Esteban sugiere priorizar el flujo de voz y tratar el OCR como una característica opcional o un "nice to have" para evitar complicaciones técnicas innecesarias en el cronograma actual ([00:12:33](#00:12:33)). Braejan David Arias Heregua propone el uso de la API de Gemini para implementar OCR de forma sencilla si el tiempo lo permite ([00:13:50](#00:13:50)).

* **Metodología de Discovery Consolidado**: Se revisa un documento de investigación que utiliza una técnica de "doble diamante" para organizar los problemas y soluciones del proyecto ([00:16:17](#00:16:17)). La propuesta de flujo comienza con una confirmación verbal del inventario y una validación visual para el usuario antes de enviar la información, con el objetivo de limpiar los datos y minimizar errores antes de guardarlos en el sistema ([00:17:29](#00:17:29)).

* **Arquitectura de roles y aplicaciones**: Daniel Enrique Rosas Esteban propone una solución dividida en dos interfaces: una aplicación móvil para los operarios, enfocada en la entrada de datos rápida, y una plataforma web para los auditores, diseñada para la aprobación o rechazo de registros. Esta separación permite que el auditor gestione las discrepancias detectadas por el sistema móvil ([00:21:20](#00:21:20)).

* **Gestión de discrepancias operativas**: El equipo acuerda que las discrepancias entre la cantidad contada y el histórico deben ser resueltas por el auditor y no por el operario, para mantener el control de calidad ([00:24:10](#00:24:10)). Se discute la necesidad de crear flujos de trabajo distintos dependiendo de si el auditor realiza su labor en sitio o desde la oficina, garantizando siempre la trazabilidad de los hallazgos ([00:25:16](#00:25:16)).

* **Seguridad de la información y privacidad**: Se analiza el riesgo legal de almacenar audios debido a la posibilidad de clonación de voz. Daniel Enrique Rosas Esteban sugiere opciones como la anonimización de frecuencias de voz o el encriptado, y enfatiza que la implementación de estándares de seguridad como la norma ISO 27001 será un valor agregado importante para la presentación final ante el cliente ([00:27:48](#00:27:48)).

* **Reducción de alucinaciones en modelos de IA**: Daniel Enrique Rosas Esteban comparte una técnica para mejorar la precisión y evitar alucinaciones en la IA, consistente en pasar la misma información por tres modelos diferentes simultáneamente. Si los tres modelos coinciden en el resultado (solicitado en formato JSON), se valida la información; de lo contrario, se reprocesa, logrando una precisión cercana al 99,92% ([00:30:37](#00:30:37)).

* **Independencia del sistema**: Se establece que la herramienta debe ser autónoma y capaz de importar archivos de Excel con la información de inventario, dado que no estará conectada directamente al sistema ERP del cliente desde el inicio. Se enfatiza que, sin la capacidad de cargar estos archivos, la herramienta no sería viable para el usuario final ([00:37:57](#00:37:57)).

* **Gestión de productos y bodegas**: El equipo discute la necesidad de que el auditor pueda registrar productos nuevos encontrados durante el inventario que no estaban en la base de datos inicial ([00:42:55](#00:42:55)). Braejan David Arias Heregua se compromete a consultar con la gerencia del cliente cómo se manejan actualmente estas situaciones para asegurar que la solución propuesta sea coherente con su realidad operativa ([00:43:56](#00:43:56)).

* **Estructura del plan de auditoría**: Daniel Enrique Rosas Esteban sugiere una estructura donde el auditor configure "planes de auditoría". Estos planes definen qué bodega se auditará, en qué periodo de tiempo y qué operarios están autorizados para trabajar en ellas ([00:48:36](#00:48:36)). Esto restringe el acceso de los operarios a bodegas no asignadas, reduciendo el error humano y facilitando el control operativo ([00:54:48](#00:54:48)).

* **Próximos pasos y preguntas para el cliente**: El equipo define una serie de preguntas clave para la gerencia del proyecto de hotelería, incluyendo la aclaración de las relaciones jerárquicas entre auditores y operarios, y quién tiene la potestad de asignar al personal a las bodegas ([00:50:58](#00:50:58)). Braejan David Arias Heregua coordinará con la gerencia para obtener estas respuestas y avanzar con el diseño técnico final ([00:53:34](#00:53:34)).

* **Configuración inicial de la auditoría**: Daniel Enrique Rosas Esteban detalla el proceso de inicio donde la persona auditora carga las bodegas, los SKU, los productos y las unidades antes de que el operario comience la ingesta de información. Se discute la posibilidad de mapear secciones de la bodega, pero se concluye que, aunque es viable, añadiría una complejidad innecesaria a la herramienta en esta etapa ([00:58:36](#00:58:36)).

* **Flujo operativo del inventario**: Braejan David Arias Heregua y Daniel Enrique Rosas Esteban analizan cómo se realizan normalmente los inventarios físicos. Observan que, si bien el inventario sigue un orden, es común encontrar anomalías donde los mismos productos están dispersos en distintas ubicaciones. Se acuerda que la herramienta debe adaptarse al comportamiento natural del usuario al realizar el inventario ([00:59:42](#00:59:42)).

* **Descarte de procesamiento de audio en tiempo real**: Los participantes discuten la viabilidad de utilizar audio en tiempo real frente a notas de voz grabadas (push-to-talk). Braejan David Arias Heregua y Daniel Enrique Rosas Esteban descartan el procesamiento en tiempo real debido a las dificultades técnicas, la alta tasa de error y la interferencia humana, optando por un modelo de "push-to-talk" para mayor practicidad ([01:02:02](#01:02:02)) ([01:07:57](#01:07:57)).

* **Mecanismo de selección de productos**: Se debate si la persona operaria debe seleccionar el producto manualmente o si la IA debe identificarlo automáticamente a partir del audio. La conclusión es que la IA intentará identificar el producto, pero la interfaz proporcionará una opción de búsqueda manual para asegurar la precisión si el sistema no logra realizar el emparejamiento correcto ([01:04:16](#01:04:16)).

* **Gestión de modificaciones y errores**: El equipo evalúa cómo manejar correcciones y discrepancias, tales como recuentos erróneos o eliminación de ítems. Daniel Enrique Rosas Esteban advierte sobre los riesgos de permitir que la IA realice cálculos aritméticos complejos, por lo que se decide restringir las funciones de voz a la creación de registros, evitando eliminar o modificar registros mediante comandos de voz para reducir posibles alucinaciones de la IA ([01:09:37](#01:09:37)) ([01:14:08](#01:14:08)).

* **Proceso de corrección de registros**: Ante la posibilidad de errores, Braejan David Arias Heregua y Daniel Enrique Rosas Esteban acuerdan un flujo de trabajo práctico: en caso de error, el usuario deberá eliminar el registro incorrecto y volver a grabarlo en lugar de intentar editarlo vía voz. Este enfoque simplifica la lógica de la IA y mejora la fiabilidad del sistema ([01:17:16](#01:17:16)) ([01:26:33](#01:26:33)).

* **Procesamiento de notas de voz**: Daniel Enrique Rosas Esteban propone limitar la duración de las notas de voz para optimizar el procesamiento y los costos. La herramienta deberá ser capaz de dividir un solo audio que contenga múltiples ítems en registros independientes. Se destaca la importancia de una capacitación (onboarding) efectiva para enseñar al usuario cómo dictar correctamente ([01:20:47](#01:20:47)).

* **Validación asíncrona de datos**: Para no interrumpir la experiencia de usuario, Daniel Enrique Rosas Esteban sugiere que la validación de datos ocurra de forma asíncrona tras la creación del registro. Se implementará un activador (trigger) que, al detectar una inconsistencia o anomalía, notificará al usuario mediante una alerta naranja para que proceda con la corrección, sin bloquear el flujo continuo de grabación ([01:27:49](#01:27:49)).

* **Fiabilidad y testing**: El equipo reconoce la necesidad de un plan de pruebas robusto para validar la fiabilidad de la herramienta. Daniel Enrique Rosas Esteban enfatiza la importancia de someter el sistema a pruebas de estrés para asegurar un margen de error mínimo, dado que el producto debe ofrecer una precisión alta para representar un cambio de paradigma ([01:23:39](#01:23:39)) ([01:32:13](#01:32:13)).

* **Planificación de roles y próximos pasos**: El equipo organiza la distribución de tareas para avanzar con el desarrollo. Se acuerda una reunión para el día siguiente a las 2:00 PM para aprobar el Documento de Requerimientos de Producto (PRD). Daniel Enrique Rosas Esteban y Braejan David Arias Heregua se encargarán de la implementación técnica y programación, mientras que Adriana Durand Calle y el resto del equipo se enfocarán en la documentación, los casos de uso y las pruebas de calidad (QA) ([01:38:50](#01:38:50)) ([01:41:26](#01:41:26)).

*Revisa las notas de Gemini para asegurarte de que sean precisas. [Obtén sugerencias y descubre cómo Gemini toma notas](https://support.google.com/meet/answer/14754931)*

*Cómo es la calidad de **estas notas específicas?** [Responde una breve encuesta](https://google.qualtrics.com/jfe/form/SV_5bXzKQfylMIhSXc?confid=Jy2k7S5X6NDjZVUNpqmoDxIQOAIIigIgABgBCA&detailid=standard&screenshot=false&entryPoint=footerMain&isGoogler=False) para darnos tu opinión; por ejemplo, cuán útiles te resultaron las notas.*

# **📖 Transcripción**

jul 23, 2026

## **Let's define the flow and tech \- Transcripción**

### **00:00:56**

**Braejan David Arias Heregua:** Adriana,

**Adriana Durand Calle:** Hola.

**Braejan David Arias Heregua:** ¿cómo vas? ¿Me escuchas? No digas que no me escuchas.

**Adriana Durand Calle:** Sí, sí, te

**Braejan David Arias Heregua:** Ah,

**Adriana Durand Calle:** escucho.

**Braejan David Arias Heregua:** insisto. No he liado con este computador todo el día, pero creo que por fin.

**Adriana Durand Calle:** Ya ves la luz.

**Braejan David Arias Heregua:** Sí, es un Mac viejito, entonces no tiene como ya soporte. Gente que se c\*\*\*\* y lo guarda y le instalé Linux. No, no sé si conozcas ese sistema operativo. Ya sé. es otro sistema operativo que es como más para otros tipos de dispositivos. La verdad es que Linux corre casi en todo, o sea, de hecho creo que puedes tener una tostadora en casa que seguramente corre Linux.

**Adriana Durand Calle:** He.

**Braejan David Arias Heregua:** es un sistema operativo muy muy ligero y y bueno, casi la mayoría de servidores de código

**Adriana Durand Calle:** O sea, sí lo he escuchado este,

### **00:01:52**

**Braejan David Arias Heregua:** y ya sé

**Adriana Durand Calle:** pero me sorprende lo que tú me acabas de decir,

**Braejan David Arias Heregua:** por

**Adriana Durand Calle:** que cualquier aparato puedes tener ese sistema.

**Braejan David Arias Heregua:** sí casi que son diseñados, diseñados para muy bajo nivel. Entonces a veces también le da como un segundo a esas computadoras viejitas. En este caso es cuando se volvió a mandar, pero es que en la otra no podía instalar nada ni nada.

**Adriana Durand Calle:** Mhm.

**Braejan David Arias Heregua:** O sea, Cloud me decía, "No, ya no lo soportamos. Un Linux es descargas, compil o hay muchas cosas ya están compiladas. Es que sabemos cuál es, pero sí, esperemos un ratito a ver si se el tercero puse el tercero en

**Adriana Durand Calle:** Sí.

**Braejan David Arias Heregua:** la cabeza.

**Adriana Durand Calle:** Igual estaba viendo lo lo que o sea lo

**Braejan David Arias Heregua:** Se hizo el ajuste solo en la cabecera.

**Adriana Durand Calle:** que van a ofrecer mañana en en lo presencial,

**Braejan David Arias Heregua:** Ajuste la secuencia de tercero Sí.

**Adriana Durand Calle:** o sea, se ve super chévere

**Braejan David Arias Heregua:** ¿Y cómo quedó terceros por con un cer y el normal y el estado

### **00:02:53** {#00:02:53}

**Adriana Durand Calle:** este,

**Braejan David Arias Heregua:** registro y en terceros Oye,

**Adriana Durand Calle:** o sea,

**Braejan David Arias Heregua:** no,

**Adriana Durand Calle:** incluso F.

**Braejan David Arias Heregua:** no eh.

**Adriana Durand Calle:** Entos, creo, o

**Braejan David Arias Heregua:** Okay. No, no lo no lo he visto.

**Adriana Durand Calle:** sea,

**Braejan David Arias Heregua:** Mira que estaba corurriendo hasta ahora. Estaba estoy en la página de activar los beneficios y e intenté activar el primero y pues no tengo ahorita Mac,

**Adriana Durand Calle:** okay.

**Braejan David Arias Heregua:** entonces no puedo instalar Houston AI,

**Adriana Durand Calle:** escucho de Houston,

**Braejan David Arias Heregua:** pero pero son obligación.

**Adriana Durand Calle:** pero este todavía no lo

**Braejan David Arias Heregua:** Tampoco lo he usado. No, ni lo conozco,

**Adriana Durand Calle:** Sí,

**Braejan David Arias Heregua:** ¿cierto?

**Adriana Durand Calle:** yo yo, es, o sea, fui a la, ¿cómo se puede decir? el workshop, no sé, a un taller que hizo el fundador, el creador, eh, y y este y ahí también compartí un enlace para poder este usarlo, ¿no?, unos créditos gratis, eh, pero no he tenido la oportunidad.

### **00:03:55**

**Adriana Durand Calle:** Igual vi la aplicación, o sea, en qué lo estaban aplicando y me pareció super chévere. Eh, yo intenté hacer eh coger los beneficios de Lovable, pero eh hay algunos que eran, o sea, beneficios gratuitos y otros tienes que tener un plan pro o un plan business para recién.

**Braejan David Arias Heregua:** Okay.

**Adriana Durand Calle:** Este,

**Braejan David Arias Heregua:** para recibir los adicionales.

**Adriana Durand Calle:** sí,

**Braejan David Arias Heregua:** Aquí.

**Adriana Durand Calle:** sí. Entonces este, o sea, lo de verdad siendo estad no lo utilizó mucho, así que no le vi la necesidad, pero pensé que en realidad sí iba a ser un acceso así gratis a a créditos este ilimitados en en todas las aplicaciones, pero en algunas sí, en algunas no.

**Braejan David Arias Heregua:** Y y pudiste o bueno, intentaste de pronto la de Gémina.

**Adriana Durand Calle:** Eh, ah, no.

**Braejan David Arias Heregua:** Yo estoy ahí, pero sucede no. O sea, como que porque él intenta,

**Adriana Durand Calle:** Pero Gemin en Gemin sí te pide creo tener un

**Braejan David Arias Heregua:** por ejemplo, estas son obligaciones que ya que están inactivas, que tenían si no hay no hay también ahí como de pronto una serie de términos y condiciones ni nada,

**Adriana Durand Calle:** planos.

### **00:05:09**

**Braejan David Arias Heregua:** simplemente ve a tu dashboard, uso y facturación. No, pero me estás dando vueltas. Yo quiero saber si las que se actualizaron son obligaciones duplicadas. Yo no creo, por ejemplo, que a mí me esto, porque yo ya hice esto alguna vez. responde. Entonces vamos desde arriba.

**Adriana Durand Calle:** Ah, okay.

**Braejan David Arias Heregua:** Entonces él entra por

**Adriana Durand Calle:** O sea, como que este duplicar beneficios ya no te

**Braejan David Arias Heregua:** U. O sea,

**Adriana Durand Calle:** permite.

**Braejan David Arias Heregua:** como que yo recuerdo que yo me inscribí, esta es el cursor de la y adquirí unos dólares de beneficio haciendo exactamente lo que dice ahí.

**Adriana Durand Calle:** Ajá.

**Braejan David Arias Heregua:** O sea, ahorita lo reintento porque lo otro que entiendo es que eh no se

**Adriana Durand Calle:** Ajá.

**Braejan David Arias Heregua:** puede no se puede usar otro correo aparte con este no se escribió a la

**Adriana Durand Calle:** Aha.

**Braejan David Arias Heregua:** ja y yo con ese yo ya pues he hecho cosas No.

**Adriana Durand Calle:** Sí. Ah. Yeah.

**Braejan David Arias Heregua:** sé si me los vayan a dar, sea como en Amazon.

### **00:06:02** {#00:06:02}

**Braejan David Arias Heregua:** Uno se registra de cero y te dan un año.

**Adriana Durand Calle:** Sí,

**Braejan David Arias Heregua:** Tercero que tenga esa obligación era cero.

**Adriana Durand Calle:** sí, yo también tengo como tres correos creados, o sea,

**Braejan David Arias Heregua:** Tanto en

**Adriana Durand Calle:** solo para usar nuevamente la aplicación y los créditos que te dan como nuevo este

**Braejan David Arias Heregua:** la

**Adriana Durand Calle:** user. Pero

**Braejan David Arias Heregua:** No,

**Adriana Durand Calle:** este

**Braejan David Arias Heregua:** mira que hace un año me banearon en Cloud, Tropic, no sé por qué les escribí muchas veces.

**Adriana Durand Calle:** así estaba de

**Braejan David Arias Heregua:** y les escribí, o sea,

**Adriana Durand Calle:** moda.

**Braejan David Arias Heregua:** qué fue lo que hice, ¿no? Y de verdad, como para evitarlo, porque un baneo es tremendo. O sea, imagínate que tu empresa dependa de eso, te vas, te mueres, te desapareces porque no tienes como.

**Adriana Durand Calle:** Claro.

**Braejan David Arias Heregua:** Entonces eso de cierta forma me dio una alerta para empezar a buscar no depender 100% de una guía. Eh, pero sin duda que Cloud es bueno y si uno tiene acceso hace muchas cosas.

### **00:06:58**

**Braejan David Arias Heregua:** y alcanzaba a hacer esto update. Entonces por ahí intenté ingresar con otro correo y no también me lo tenía bloqueado desde el inicio. yo, pero qué c\*\*\*\*\*

**Adriana Durand Calle:** Sí. Ajá.

**Braejan David Arias Heregua:** sacar lo que hice.

**Adriana Durand Calle:** cuentas asociadas también, o sea,

**Braejan David Arias Heregua:** es

**Adriana Durand Calle:** creo que toman en cuenta desde qué computadora creaste tu correo para que todas ellas este, o sea, las que están vinculadas también te las bajan. Sí, eso sí escuché. O sea, super rarísimo este. O sea, es es bien

**Braejan David Arias Heregua:** Exactamente. Y esto seguro que se lo había puesto.

**Adriana Durand Calle:** loco. Utilicé Figma, o sea, digamos que ya habíamos acordado en la tarde, o sea, a las a las 3, en la reunión de las 3, que había una eh ya una solución, digamos, eh mayoritariamente.

**Braejan David Arias Heregua:** como acordada más o menos como concretada

**Adriana Durand Calle:** Ajá.

**Braejan David Arias Heregua:** con Adios.

**Adriana Durand Calle:** Sí, exacto. Este igual eh hice cómo sería el el flujo, ¿no?

### **00:08:00** {#00:08:00}

**Adriana Durand Calle:** Porque o sea, no es solamente es un eh eh una de voz, sino que como bueno, igual después le vamos a cambiar el nombre, supongo. El contador de inventario por voz es también como un asistente, ¿no? O sea, te confirma si es que los datos que estás tú diciendo este son los correctos. eh y el digamos este el qué tipo de preguntas eh o sea estaba digamos haciéndole doble clic a esa solución para para que digamos este saber qué tipo de preguntas se le puede hacer para confirmar la información y no generar un sesgo, ¿no? O sea, si decimos porque la propuesta era que el, o sea, digamos que seguro también a ustedes les aparecido, No. Eh, dijiste 90 o nueve, ¿no? Recuerda que este, o sea, el stock anterior no es de 90, algo así era como lo que ofrecía este o recomendaba la No, a mí Cloud creo que me recomendó eso y me dijo que no sea, o sea, para que no la el conteo no esté direccionado, ¿no? Solamente permite que te confirmen entre un sí, con un sí o con un no. Ahí está Daniel.

**Braejan David Arias Heregua:** para tomar uno de estos y y rectificar,

**Adriana Durand Calle:** y en base a eso,

### **00:09:42** {#00:09:42}

**Braejan David Arias Heregua:** ver cómo quedó la obligación.

**Adriana Durand Calle:** en base a eso este eh eh establecí un flujo en realidad, o sea, así como habíamos dicho, un flujo de solución e porque depende también de qué bodega, ¿no? Tienes que seleccionar la bodega para que de acuerdo a esa selección te lance todos los productos que que están en esa bodega, ¿no? y también lancé a Figma el no como sería un mo cuanto a a pantallas e para que pueda ha una digamos este por eso te digo, no es solo un este un reconocimiento de voz, sino también el el resultado final es que haya una no un entregable un, o sea, sí, un descargable que luego se pueda subir a su sistema y pueda completarse el el stock este por allá, o sea, en el sistema. Eh, pero no sé, este, he seguido también la la el plan de trabajo averiguando sobre datos sensibles de voz que puede haber como si hay algún tema, ¿no?, de en cuanto al tratamiento, ya que es un trabajador, ¿no? Eh, que era lo que indicaba el plan de trabajo. Por ese lado no hay riesgo, o sea, en realidad es necesario el consentimiento porque se va a utilizar para un objetivo de de trabajo que finalmente la voz no se va a utilizar, todo se va a condensar en un e en un cuadro o en el sistema en todo caso, ¿no?

### **00:11:31**

**Adriana Durand Calle:** y eso.

**Braejan David Arias Heregua:** Sí, o sea, no vamos a almacenar la voz, pero pero sí si Daniel,

**Adriana Durand Calle:** Mhm.

**Braejan David Arias Heregua:** tú mencionabas temprano que que está, o sea, que debemos en lo posible hacer un un unas evaluaciones o pruebas con con voces reales,

**Adriana Durand Calle:** Creo

**Braejan David Arias Heregua:** ¿no? Eso sería, eso sería para evaluar el transcript o para evaluar todo El

**Adriana Durand Calle:** Ah.

**Braejan David Arias Heregua:** fluo de las esos son 10,000 que las otras eran encabezados solos, oíste nuestro lado.

**Daniel Enrique Rosas Esteban:** Perdón, tenía el micrófono apado.

**Braejan David Arias Heregua:** Bueno, es que

**Daniel Enrique Rosas Esteban:** Eh, sería para todo el flujo, pero se puede hacer por partes, obviamente, si no entender. Eh,

**Adriana Durand Calle:** Mhm.

**Daniel Enrique Rosas Esteban:** perdón que llegué tarde, la verdad me agarró el trancón, no me dio tiempo de llegar a las 6 en puntico. Acabé de llegar a la casa. Mire, le saludé.

**Braejan David Arias Heregua:** ¿Está seguro que hizo el hizo elación en

**Daniel Enrique Rosas Esteban:** Buena,

**Braejan David Arias Heregua:** tercera?

**Daniel Enrique Rosas Esteban:** consía la casa.

### **00:12:33** {#00:12:33}

**Braejan David Arias Heregua:** Se ve que es más consentida. Eso.

**Daniel Enrique Rosas Esteban:** Bueno,

**Adriana Durand Calle:** H

**Daniel Enrique Rosas Esteban:** entonces eh yo apenas me estoy poniendo al corriente, estoy revisando el grupo de WhatsApp y encuentro que hablan de aparte de reconocimiento de voz, también reconocimiento de imágenes, ¿cierto? Incluso estoy tratando de como entender a profundidad lo que está diciendo Adriana. Tengo mi percepción respecto a el tema de las imágenes, más que todo por el tiempo, que validar un modelo de OCR y un modelo de audio al mismo tiempo, o sea, en este mismo periodo de tiempo puede ser algo que nos juegue en contra. No sé si BR está de acuerdo conmigo en ese

**Braejan David Arias Heregua:** diciendo que que ya quedó. Yo yo nosotros a las 3 estuvimos por ahí reunidos mirando ciertas investigaciones y cosas que también adelantó.

**Daniel Enrique Rosas Esteban:** aspecto.

**Braejan David Arias Heregua:** Listo. Y una de las cosas que hablamos es de podríamos seguir el el la recomendación que dieron hoy en la charla y es definamos un un alcance muy acotado y si nos queda chance de agregarle los hacemos,

**Daniel Enrique Rosas Esteban:** Mhm.

**Braejan David Arias Heregua:** ¿sabes? O sea, como que sí podemos enfocarnos en voz y si nos queda chance de meterlo, lo metemos.

### **00:13:50** {#00:13:50}

**Braejan David Arias Heregua:** Yo con lo de OCR saldría un poco caro,

**Daniel Enrique Rosas Esteban:** Mhm.

**Braejan David Arias Heregua:** pero si podemos activar los créditos que que son de Gemini, usar el API de Gemini para eso es, o sea, yo lo estuve usando en unas pruebas internas y la verdad es que sí, tú le das el promito ahí como de de más o menos de OCR o dame esta información en Jason o como sea que uno la quiera, pero el de Jemy Knight de cierta forma pues es estable y bueno, quizás no sea el mejor, quizás vaya a tener sus fallas, pero creo que por ahí podríamos tener una opción no tan complicada.

**Daniel Enrique Rosas Esteban:** Hm.

**Braejan David Arias Heregua:** Sin embargo, lo veo también así como un nice to más que un nice to have es un feature que si nos da lo agregamos. Eso es la perspectiva que lo veo

**Daniel Enrique Rosas Esteban:** Okay,

**Braejan David Arias Heregua:** también.

**Daniel Enrique Rosas Esteban:** esto

**Braejan David Arias Heregua:** Listo.

**Daniel Enrique Rosas Esteban:** M.

**Braejan David Arias Heregua:** Y no sé si has tenido chance de ver lo que propuso, bueno, Cloud y que materializó Edit, pero si no lo compartimos otra vez Okay.

**Daniel Enrique Rosas Esteban:** Yo hasta ahora lo estoy hasta ahora me estoy sentando a revisar el WhatsApp y todo lo que

### **00:14:58**

**Braejan David Arias Heregua:** Ok.

**Daniel Enrique Rosas Esteban:** están haciendo. Entonces, estoy revisando como lo que pasó ahí. Y entonces estoy tratando de entender que que ya hay unas soluciones implementadas, ¿cierto? Y eso ya fue lo que lo que hizo fue tratar de de compactarlas para que nosotros la pudiéramos

**Braejan David Arias Heregua:** Pues,

**Daniel Enrique Rosas Esteban:** ver.

**Braejan David Arias Heregua:** o sea, fueron como seis propuestas, creo, que que logró condensar y una recomendada.

**Daniel Enrique Rosas Esteban:** Mhm.

**Braejan David Arias Heregua:** Eh, pues estuvimos ahí como discutiendo sobre ella, pero pues la recomendada es básicamente lo mismo que hablaste esta mañana. Eh, bueno, no es básicamente eso, pero digo, está orientada por ahí y y nada,

**Daniel Enrique Rosas Esteban:** Ok.

**Braejan David Arias Heregua:** pues yo creo que podemos ahorita sentarnos y repasarla y ver por ahí qué ves de pronto tú. Yo ya no vi nada raro, creo que es totalmente factible, pero pues la podemos mirar. ¿Qué más hizo? Es una matriz D. Espera,

**Daniel Enrique Rosas Esteban:** El flujo del que estaba hablando ahorita,

**Braejan David Arias Heregua:** ya

### **00:16:17** {#00:16:17}

**Daniel Enrique Rosas Esteban:** Adriana, ¿lo tienen en algún en algún sitio para verlo o apenas estamos discutiendo los

**Braejan David Arias Heregua:** no, o sea,

**Daniel Enrique Rosas Esteban:** flujos?

**Braejan David Arias Heregua:** como que no ya estaba comentado. Espérame, ya lo busco porque Edil subió, pero tú crees que me acuerdo en cuál es.

**Daniel Enrique Rosas Esteban:** Yo estoy viendo un montón de

**Braejan David Arias Heregua:** Creo que es en el que creo que es el que dice Discovery consolidado.

**Adriana Durand Calle:** Sí,

**Braejan David Arias Heregua:** Sí,

**Adriana Durand Calle:** es en el Discovery.

**Braejan David Arias Heregua:** ese consolidado y que está entre paréntesis reto

**Daniel Enrique Rosas Esteban:** Eh,

**Braejan David Arias Heregua:** hotelería.

**Adriana Durand Calle:** M.

**Braejan David Arias Heregua:** Están por por cada está como la problemática y bueno, lo que pasa es que hizo algo que yo no conocía también interesante, que es una una técnica de doble diamante, creo que se llama.

**Adriana Durand Calle:** Sí.

**Braejan David Arias Heregua:** para para ahí está el documento también se llama doble diamante, problema y solución y y ahí pues como que de ahí es donde parten

**Daniel Enrique Rosas Esteban:** Mhm.

**Adriana Durand Calle:** Ah.

**Braejan David Arias Heregua:** ciertas la investigación o bueno, los sí, el research que se hizo y eh y en el Excel pues ya está como el flujo eh propuesto y pues arranca es con una confirmación verbal del

### **00:17:29** {#00:17:29}

**Daniel Enrique Rosas Esteban:** Ok.

**Braejan David Arias Heregua:** del audio de lo que se está diciendo, pues del del stock, pero pues ahorita lo que mencionaba Adriana super importante es como esto también está eh en una base de datos, ¿no? Pues nos pasaron un Excel y demás, o sea, como que hay que confirmar también en qué bodega estás y esto. E mira que ahí dice como visual del dato antes de enviar, o sea, como que el el usuario llega y dice, no sé, eh, 90 9 kg de arroz y como que

**Daniel Enrique Rosas Esteban:** Mhm.

**Braejan David Arias Heregua:** antes de confirmar simplemente le puede aparecer ahí y el usuario confirme, pues sigue siendo una confirmación, pero pues ya no, o sea, lo puede como reintentar, recorregir o no sé, lo que sea. La ideal, lo ideal es que no dijite,

**Adriana Durand Calle:** H

**Braejan David Arias Heregua:** pero pero si se va un un stopper antes de enviarlo y eso pues nos permite limpiar también la data un poquito antes de de guardar.

**Daniel Enrique Rosas Esteban:** Ne.

**Braejan David Arias Heregua:** Eh, hay hay unas validaciones, validación de rango por artículo, eso sí no no lo sé. y alerta cuando el valor es atípico, no sé, ese tipo de cosas, pues, o sea, ese es el flujo propuesto, pero pero Ajá, no todavía no no tenemos, digamos, aterrizado técnicamente como cómo lo vamos a a hacer.

### **00:19:07**

**Daniel Enrique Rosas Esteban:** H Listo. Ahí estoy viendo el flujo. J.

**Braejan David Arias Heregua:** igual, o sea, también si tú tienes agrech complementario en Latinoamérica y Colombia, espero lo puedan ver en la red. hacia esta nos agregó ahorita. Ah, descargo este matriz 3 a ver qué tiene y lo comparto.

**Daniel Enrique Rosas Esteban:** Dame un minuto, ya regreso. al baño un momento.

**Braejan David Arias Heregua:** Dale.

**Daniel Enrique Rosas Esteban:** Eso una cuenta una cuenta.

**Braejan David Arias Heregua:** Okay, no pas nada.

**Daniel Enrique Rosas Esteban:** No, es que ahora sí lo que pasa es que yo tengo como muchos puntos en mi cabeza y me está costando trabajo ver si les estamos dando solución. O sea,

**Adriana Durand Calle:** Yeah.

**Daniel Enrique Rosas Esteban:** estoy teniendo como puntos de dolor o puntos de fricción. E básicamente lo que quiero decir son entendemos

**Braejan David Arias Heregua:** Mhm.

**Daniel Enrique Rosas Esteban:** o creería que estaríamos todos en la misma sintonía sabiendo que son dos herramientas prácticamente las que vamos a construir. una que sería una especie de una app mobile y la segunda que sería una especie de la misma app, pero maybe en el computador porque tenemos dos usuarios

### **00:21:20** {#00:21:20}

**Braejan David Arias Heregua:** H

**Daniel Enrique Rosas Esteban:** distintos que van a estar usando la herramienta, el usuario que ingresa la información que va a necesitar practicidad y que sea ligera y

**Adriana Durand Calle:** Ah.

**Daniel Enrique Rosas Esteban:** movible, que sería el usuario de mobile y el usuario auditor.

**Braejan David Arias Heregua:** Ok.

**Daniel Enrique Rosas Esteban:** que va a necesitar ver todo el insumo que levantó el usuario que está ingresando la información para aprobarlo o

**Adriana Durand Calle:** Ho.

**Daniel Enrique Rosas Esteban:** denegarlo. ¿Sí? Entonces, ¿qué ocurre? Les voy a explicar el proceso de inventario que yo he seguido y como yo lo he visto a lo largo de la carrera que llevo. El auditor no tiene la capacidad operativa para revisar absolutamente el inventario entero de una bodega. Entonces, lo que el auditor puede hacer es revisar inconsistencias o incidencias puntuales donde él tiene cierto tipo de dudas. ¿Quiénes son los que hacen el inventario? Los operarios. ¿Listo? Entonces, a a eso es a lo que ellos hacen referencia cuando eh dicen que les traen unos papeles y ellos tienen que revisar todo lo que escribieron en los papeles, etcétera, etcétera, etcétera. Entonces, básicamente la con una aplicación móvil resolveríamos la ingesta de información y todos estos puntos de dolor que ustedes dicen que cuando él acepta o rechaza o tiene inconsistencias, estaríamos hablando de la app móvil, ¿cierto?

### **00:23:03**

**Braejan David Arias Heregua:** Sí, en ese punto sería el que está recolectando la información,

**Daniel Enrique Rosas Esteban:** Y

**Braejan David Arias Heregua:** que en tiempo real vio que lo que habló fue consistente con lo que le quiso decir o le dijo.

**Daniel Enrique Rosas Esteban:** exa exacto.

**Braejan David Arias Heregua:** No.

**Daniel Enrique Rosas Esteban:** que incluso todas esas inconsistencias que ocurran en el proceso deben quedar documentadas o señaladas como un warning o guardadas en una base de datos, porque son esos errores o esas inconsistencias a las que la persona auditora tendría que o le gustaría hacer zoom. ¿Sí me va a entender? Es decir, como el operario 5 eh reportó o tuvo advertencias en 17 productos, el operario dos solo en dos. Claro, es una anomalía estadística que el uno tenga inconsistencias en 17 y el dos solamente en dos. Entonces, voy a revisar cuál es el reporte del 17 y posiblemente me tenga que parar, ir a acompañarlo a revisar cuál. ¿Por qué se ocurrieron esas inconsistencias? etcétera. Esa es como la función del auditor.

**Braejan David Arias Heregua:** Pero espera que me perdí. O sea, yo estaba hablando de que, por ejemplo, no sé, miré 19 kg de arroz y dije 19 kg de arroz y me puso nueve,

### **00:24:10** {#00:24:10}

**Daniel Enrique Rosas Esteban:** Mhm.

**Braejan David Arias Heregua:** ¿cierto? O sea, entonces no son 19\. Entonces, o sea, en esa móvil inicial, pues va a tener como la posibilidad de ajustarlo para que simplemente diga listan 19, pero no entiendo esa la parte en la que ahí se vuelve como un warning para el auditor, a menos que sea otra cosa,

**Daniel Enrique Rosas Esteban:** Listo.

**Braejan David Arias Heregua:** obviamente.

**Daniel Enrique Rosas Esteban:** Claro. E, ¿qué ocurre? ¿Recuerdas que en todo el flujo de trabajo, incluso aquí lo creo que lo estoy viendo, que es unidad correcta, cantidad razonable versus histórico.

**Braejan David Arias Heregua:** Ah, bueno, sí.

**Daniel Enrique Rosas Esteban:** Listo, ahí está.

**Braejan David Arias Heregua:** Yes.

**Daniel Enrique Rosas Esteban:** Entonces, claro, una cantidad razonable versus el histórico no debería resolver esa discrepancia el operativo, sino que esa discrepancia la debería resolver el auditor al menos desde el flujo de trabajo que yo he visto y yo conozco. ¿Sí me va a entender?

**Braejan David Arias Heregua:** Okay. O sea, la app del auditor es la que si va a tener el historial para saber si el registro que que le hicieron es de cierta forma

**Daniel Enrique Rosas Esteban:** Básicamente es que yo como no tengo la operación completa de col subsidio

### **00:25:16** {#00:25:16}

**Braejan David Arias Heregua:** consistente.

**Daniel Enrique Rosas Esteban:** hasta las entrañas de saber si el auditor está en la bodega o si el auditor está en una oficina esperando a que le lleguen los papeles, aquí es donde no sé cómo resolver ese tipo de cosas.

**Braejan David Arias Heregua:** Va a cálde. Yo puedo entrar mañana. muy muy temprano ayudar. O sea, esas dudas puntuales en sí yo no soy tan como tan conocedor para hacerlas, pero sí podemos empezar a sacar todas estas preguntas. Eh, si quieres no más hazla en el para que quede en la transcripción. hago en el resumen y mañana mi idea es apuntarle directo a la gerente, o sea, buscar a la gerente y sacarle los minutos que necesito y puedo resolver todas estas preguntas al menos con la voz de ella o desde el lado de ella, pues. Yeah.

**Daniel Enrique Rosas Esteban:** Listo. Porque entonces, ¿qué es lo que ocurre? El digamos que se modelaría muy distinto si el auditor está en el sitio o si el auditor está en una oficina. Si el auditor está en el sitio y se genera una discrepancia de cantidad razonable versus histórico y comportamental, es el auditor en sitio el que debería entrar a aprobar o declinar ese registro o corregir.

### **00:26:33**

**Daniel Enrique Rosas Esteban:** Si el auditorio está en la oficina, es el operativo el que aprueba o declina el registro. Sin embargo, al auditor le tendría que generar un reporte de esa anomalía. para que él pueda auditar, valga la redundancia, ese registro y tratar de entender o buscarle un por qué está ocurriendo esa anomalía, dejar una trazabilidad completa. Yeah. Entonces, a eso es a lo que me refiero con que capaz en los flujos que estamos haciendo, si son muy simples, eh, son muy sencillos, pero tenemos que tener esos dos caminos o esos dos flujos conectados porque son dos usuarios completamente distintos los que van a estar interactuando con la solución o los que tenemos que tener en cuenta para poder desarrollar la solución.

**Braejan David Arias Heregua:** Te entiendo, te entiendo. Sí, o sea, no entiendo de fondo lo mismo. No sé cómo está pasando en este momento, pero pero ya veo claramente la separación de es como la separación, pero al final es parte de lo mismo, o sea, tienen que tener acceso al mismo a la misma

**Daniel Enrique Rosas Esteban:** Sí,

**Braejan David Arias Heregua:** información.

**Daniel Enrique Rosas Esteban:** pero van a interactuar con ella de forma distinta.

**Braejan David Arias Heregua:** Sí.

### **00:27:48** {#00:27:48}

**Daniel Enrique Rosas Esteban:** Entonces, eh yo no sé si sea pertinente o no sea pertinente guardar los audios o no guardar los audios. Eso es algo que podemos determinar más adelante, porque el audio podría servir como una especie de auditoría para como insumo para el auditor en llegado caso de que él lo quiera escuchar, ¿cierto?

**Braejan David Arias Heregua:** Ahí e Adriana, yo creo que podemos también de tu lado conocer un poco, no sé si puedas conocer un poco, investigar un poco, porque tenemos unos temas legales. con los audios porque esa información primero privada, o sea, como que actualmente a través de un de 5 segundos no más se pueden clonar la voz. Entonces es como si vamos a almacenar esos audios tenemos que tener una forma legal en la en las cuales eh pues establezca y y lo acepte porque bueno, vienen temas legales. Ese es esa ese es el tema con guardar los audios. Si si no tenemos ningún problema legal,

**Daniel Enrique Rosas Esteban:** Mhm.

**Braejan David Arias Heregua:** bacano, eh, porque pues va a servir para obviamente mejorar más adelante el sistema y demás, pero bueno, creo que ahí la anotación sería eso. Legalmente, ¿qué qué tendríamos en contra de almacenar información de cierta forma personal que puede rastrear a la persona en algún momento?

### **00:29:10**

**Braejan David Arias Heregua:** M.

**Daniel Enrique Rosas Esteban:** Igual se podría tratar de anonimizar la voz, es decir, pasarla por un modelamiento previo, eh que la que baje las frecuencias, la convierta neutro, etcétera, etcétera, a la hora de almacenar o simplemente almacenar el audio encriptado. O sea, hay como muchas maneras, simplemente es tratar de delimitar cuál va a ser nuestro alcance para este punto, porque no nos podemos extender infinito. Y eh si sería super bueno esto que estamos hablando de brindarles muchísima confianza a la hora de de plantear a través de ISO 27001, explicar cuáles son los canales seguros, bajo qué encriptación viaja, bajo toda esa parte técnica de seguridad de la información en nuestro bloque. Podría también ser un plus extra para la presentación final que vayamos a hacer, porque por lo que veo a ellos les importa bastante el tema de seguridad de la información y si nosotros llegamos eh hablando de que a nosotros también nos importa y vamos a trabajar para ayudarlos a preservar esos túneles seguros de comunicación, superb. Listo. Lo otro que les quería contar es a través del eh la forma en como yo estoy planteando el reconocimiento de voz. Desde mi perspectiva, usar un solo modelo de AI para el reconocimiento de voz deja mucho margen de error para las alucinaciones, muchísimo.

### **00:30:37** {#00:30:37}

**Daniel Enrique Rosas Esteban:** O sea, yo en las implementaciones de automatización que he hecho con un solo modelo de EI, estoy teniendo alrededor de un 82% de efectividad,

**Braejan David Arias Heregua:** Ok.

**Daniel Enrique Rosas Esteban:** lo que me deja un 18% de error. y lo vamos y lo medimos con la investigación que estaba haciendo yo ayer de un a un 4%, tener un 18% de alucinaciones es un cap muy grande como para que sea viable. Entonces, la técnica que yo eh planteé en el en mi en la empresa donde trabajo es la misma que se plantean para los cálculos aeroespaciales, que es en lugar de tener un modelo, tienes tres modelos iguales, tres modelos distintos y lo que haces es que le pasas la información al modelo uno y le pides que te la devuelva en x en x formato. Yo normalmente se la pido en Jason. Le digo, "En Jason dame cantidad, en Jason dame tipo, en Jason dame bodega y en Jason no sé qué." y no claro, si yo de los tres modelos recibo el mismo Jason, el procesamiento fue correcto. Si hay una discrepancia entre los modelos de aunque sea uno de los modelos alucinó, reprocéseme el audio para revisar que los tres estén correctos. ¿Listo?

### **00:31:50**

**Daniel Enrique Rosas Esteban:** Eso genera una precisión del 99,92% más o menos, evitando alucinaciones al menos por ese

**Braejan David Arias Heregua:** Okay, bien,

**Daniel Enrique Rosas Esteban:** lado.

**Braejan David Arias Heregua:** bien. ¡Chévere\! Daniel, qué bueno la experiencia que tienes,

**Daniel Enrique Rosas Esteban:** Gracias. Eh, igual es para ponerla al servicio del equipo.

**Braejan David Arias Heregua:** ¿eh? Sí, no, o sea, igual estoy tomando todas las notas ahorita eh con el objetivo precisamente de de incluso puedes mencionar el flujo, ¿sabes? O sea, el flujo que tengas en la cabeza lo puedes mencionar e y lo contrastamos, pero la idea es de acá dibujar los flujos y y que los podamos empezar a ver de tal manera que mañana empezamos ya a decantarnos por uno y a irnos. Pero me parece superb lo que mencionas de de la resiliencia para para precisamente evitar eh, o sea, para realmente dar valor, porque al final actualmente tienen el mismo problema, solo que les toma más tiempo, pero pues si nuestro modelo o nuestro análisis va a generar un gap de, no sé, digamos que 20%, pues a pesar de ser Centa.

### **00:32:59**

**Braejan David Arias Heregua:** lo lo que sale sigue siendo un gat muy grande de Pero entonces eh no sé si también

**Daniel Enrique Rosas Esteban:** M.

**Braejan David Arias Heregua:** has pensado de qué manera eh vamos a hacer esa información porque eh a moverla porque o sea seguro que hay que mantener como algo de eventos o algo porque en este caso, por ejemplo, es un retry, es como, ah, llegó una nueva solicitud, venga la la mando a tres diferentes, o sea, como que sí va a haber una espera ahí. Entonces, no sé cómo cómo ves la parte en la que si quieres también pues danos una idea de lo que tengas es, okay, me acerco con el dispositivo y lo envío y de ahí en adelante, ¿cómo se hace es esa esa validación? Yeah.

**Daniel Enrique Rosas Esteban:** Entonces, déjame voy. ¿Cómo es que se escribía tablero en inglés?

**Braejan David Arias Heregua:** tablet.

**Daniel Enrique Rosas Esteban:** tablero.

**Braejan David Arias Heregua:** Ah,

**Daniel Enrique Rosas Esteban:** Ya

**Braejan David Arias Heregua:** ufard un dashboard. M.

**Daniel Enrique Rosas Esteban:** es porque no tengo el iPad, no se los dibujaría más más fácil. Entonces, déjenme les comparto como pantalla y voy dibujando el flujo que tengo yo en la cabeza y ustedes me van

### **00:34:32**

**Braejan David Arias Heregua:** Eh, o escalidro,

**Daniel Enrique Rosas Esteban:** contando.

**Braejan David Arias Heregua:** no sé si te gusta. A mí me gusta mucho

**Daniel Enrique Rosas Esteban:** A mí me gusta dibujar.

**Braejan David Arias Heregua:** escalidro.

**Daniel Enrique Rosas Esteban:** Sí, si por mí fuera lo escribía en el cuaderno, pero no tengo forma de de decírselo,

**Braejan David Arias Heregua:** Gracias.

**Daniel Enrique Rosas Esteban:** ¿cierto? Entonces, básicamente, vamos a tener este cuadradito de acá que va a ser el operario y este triangulito de acá va a ser el auditor. ¿Listo? Entonces de normal tenemos, bueno, la base de datos dice que tenemos diferentes bodegas. Ustedes cuando se imaginaron la herramienta pensaron en cómo vamos a solucionarlo en las bodegas, porque hay dos formas de hacerlo, a través de la inteligencia artificial, que sería ponerle más carga de procesamiento, o a través de un preformulario, una asignación de roles, que sería yo estoy en la bodega tal tal y voy a hacer el inventario la bodega tal tal. ¿Cierto? Entonces,

**Braejan David Arias Heregua:** Sí,

**Daniel Enrique Rosas Esteban:** no sé ahí si eso ya lo resolvieron.

**Braejan David Arias Heregua:** ahí Adriana, Adriana tenía ahorita algo de eso.

### **00:35:33**

**Braejan David Arias Heregua:** Si quieres, Adriana, nos cuentas lo

**Adriana Durand Calle:** Sí. O sea, en realidad la primera eh este la primera opción de pantalla era que empiece con una selección, ¿no? O sea, la selección de la bodega, porque eso va a determinar la selección de los productos que contiene cada bodega.

**Daniel Enrique Rosas Esteban:** M.

**Adriana Durand Calle:** Eh,

**Braejan David Arias Heregua:** Sí. M.

**Adriana Durand Calle:** y o sea por ahí digamos que podemos

**Braejan David Arias Heregua:** Yo yo la la opción que que propone Adriana, o sea, como que de cierta forma es la más familiar también para uno como usuario de cualquier aplicación, pero también más flexible en este punto porque digamos complicarla, ¿no? digamos que decir, "Listo, es que esta persona tiene asignadas estas bodegas, se abre muy, no sé, ahí también tú, Daniel, nos podrías decir, pero yo de lo poco que conozco siento que esto también es como, okay, puedes ir a revisar esta otra, o sea, como que no necesariamente está planificado siempre la persona para hacer esas exactas, sino que puede hacer más o puede hacer menos. No sé si,

**Adriana Durand Calle:** Ok.

**Daniel Enrique Rosas Esteban:** Listo.

**Braejan David Arias Heregua:** o sea, como que puede ser variado.

### **00:36:38**

**Daniel Enrique Rosas Esteban:** Entonces, esto nos genera el hecho de que la persona seleccione la bodega, nos genera otro módulo de procesamiento o otro flujo que no teníamos previsto, que es cómo se le asigna a cada usuario a la bodega. Entonces, el auditor probablemente barra auditor barra administrador va a necesitar un módulo completo de gestión de usuarios.

**Braejan David Arias Heregua:** Sí, eso eso sí lo complicaría. Por eso, por eso digo, o sea, yo lo que me imagino es que como ejemplo, yo soy col subsidio y tengo que ir hoy a hacer tres bodegas, me voy con la API, simplemente yo selecciono, yo sé a qué bodega voy a ir, porque actualmente con el papel funciona así, con el papel, de hecho, el papel está muy abierto y en el papel tengo entendido que escriben a bodega tal y empiezan.

**Daniel Enrique Rosas Esteban:** Yo a mí,

**Braejan David Arias Heregua:** Entonces,

**Daniel Enrique Rosas Esteban:** bueno, yo le va a tirar los pros y los contra para que vayamos decidiendo. El hecho de de hacerlo así como lo propone Durena es que complejiza la herramienta a nivel de manejo de usuarios. Sí o sí hay que generar un módulo de manejo de usuarios, creación de usuarios, habilitación de usuarios, envío de correo electrónico. ¿Por qué?

### **00:37:57** {#00:37:57}

**Daniel Enrique Rosas Esteban:** Porque la herramienta no puede depender de que estemos nosotros ahí todo el tiempo directamente en la base de datos, creando usuarios, asignando roles, etcétera, etcétera, etcétera, porque eso no no se ve en ningún sitio. Sí. Entonces, obviamente tendríamos que el auditor tendría que tener bastante control sobre la herramienta en el sentido de debería poder crear bodegas, debería poder cargar información de históricos de datos de esas bodegas porque nosotros no podemos asumir que la base de datos que nosotros estamos teniendo va a ser la que

**Adriana Durand Calle:** Ha.

**Daniel Enrique Rosas Esteban:** siempre exista, sino que ellos una vez la manden al RP, interactúen completamente con el RP para iniciar la auditoría de X sitio. Lo más probable que va a pasar es que van a extraer la información del RP otra vez en un Excel, la van a meter a la herramienta para que la herramienta tenga el histórico de datos.

**Adriana Durand Calle:** Yeah.

**Daniel Enrique Rosas Esteban:** Obviamente más adelante nos podemos inventar que si puentes y conexiones de SQL. y no sé qué y esté conectado directamente, pero por el momento esto es una herramienta completamente aparte al módulo de LP de ellos y tenemos que pensarla como una herramienta completamente autónoma, independiente y por ende se la regla número uno, si usted crea una herramienta que no permita cargar Excel, nadie la va a usar.

### **00:39:21**

**Daniel Enrique Rosas Esteban:** ¿Listo? Entonces la herramienta debe permitir cargar los exceles de información del inventario existente en la base de datos.

**Braejan David Arias Heregua:** el que tenemos actualmente que nos suministraron.

**Daniel Enrique Rosas Esteban:** Exacto. Básicamente la herramienta debe permitir cargar ese Excel para que funcione como su base de datos, de productos, de esto, de aquello, de etcétera, de todo esto. Y desde ahí parte el análisis. Esto es ahora tendríamos que pensar en cómo se va a comunicar eso a lo largo del tiempo, ¿no? Porque nuestra herramienta no tiene un manejo real, un manejo en tiempo real de los inventarios. Por ende, lo que vaya entrando mes a mes, ¿qué va a ser? El punto de partida, va a ser un intermedio, se va a arrestar, tiene que coincidir con lo que pasamos o no, porque hay una desconexión significativa entre lo que pasa en tiempo real y lo que va a estar en la herramienta auditoría. Entonces, cuando ellos hablan de es que tiene que extraer la información y manejar la información histórica de los inventarios, ¿sist? Y cómo va a tener esa cómo va a tener acceso a la información histórica. Actualmente la tenemos en un Excel, eso es todo lo que tenemos y consistente y continuamente va a estar recibiendo Exceles cargados o se va a conectar a la base de datos, etcétera, etcétera.

### **00:40:36**

**Daniel Enrique Rosas Esteban:** Como lo digo, que hay que pensarla como una herramienta independiente. Deberíamos poderle darle la potestad al auditor de que él vaya cargando la información, pensarla como un módulo fácil que venga, tome, úsela ya está parametrizada para que reciba los exceles. ¿Listo?

**Braejan David Arias Heregua:** Y yo en eso ya había considerado y bueno, habíamos hablado de su base en algún momento y realmente lo que había considerado es como no

**Daniel Enrique Rosas Esteban:** Mhm.

**Braejan David Arias Heregua:** lo había pensado de esa manera, la verdad, pero se había considerado volver este Excel una base de datos, pero algo más, o sea, Excel datos, digo, pasar la postgres,

**Daniel Enrique Rosas Esteban:** relacional y transaccional,

**Braejan David Arias Heregua:** pero exacto. Pero entonces, claro, no,

**Daniel Enrique Rosas Esteban:** básicamente.

**Braejan David Arias Heregua:** eso se vence, por decirlo así. Sé que esto es mensual, pero este dato de de se vence en el próximo mes, o sea, como que sí va a haber una actualización constante

**Daniel Enrique Rosas Esteban:** Claro, porque o sea, él al final lo que te va lo que va a hacer es yo estoy recibiendo el dato del inicio del inventario o del inicio del mes pasado del inventario del último mes o las existencias.

### **00:41:43**

**Daniel Enrique Rosas Esteban:** Luego estoy recibiendo cómo se movió en tiempo real, porque esas modificaciones en tiempo real a lo largo del mes yo no las voy a tener en mi herramienta, me las van a tener que extraer del RP, luego las voy a tener que volver a cargar en la herramienta y tiene que empezar a crearse un histórico de información. que sea congruente en muchos aspectos con lo que vamos teniendo atrás, atrás, atrás, atrás, atrás. Obviamente para este reto no funciona, pero la ¿Por qué? ¿Por qué llegué a este punto? Porque básicamente, ¿de dónde van a salir las bodegas que van a manejar? De la base de datos, ¿sí? A entender, o sea, se le hace una caracterización a la cantidad de bodegas,

**Braejan David Arias Heregua:** Sí, sí, sí. Yeah.

**Daniel Enrique Rosas Esteban:** etcétera. Ahora, ¿qué pasa? Va, va, va. Yo tengo un inconveniente aquí. es qué productos se mane se manejan en esas bodegas, solo lo que tenemos en la base de datos o vamos a permitir que se creen productos dentro de la bodega, así no estén en la base de datos inicial. Ejemplo, en la en la bodega uno no existían bolitas de chocolate al inicio del mes o en la o en la carga inicial, pero resulta que empezaron a hacer el inventario y encontraron un una caja con 15 kg de bolitas de chocolate.

### **00:42:55** {#00:42:55}

**Daniel Enrique Rosas Esteban:** El auditor debe tener la potestad de crear el producto. El producto se debe mapear porque la inteligencia artificial no va a ser capaz de resolver ese tipo de cosas.

**Braejan David Arias Heregua:** Vale, bueno, igual es es eso es una pregunta que repito, mañana mi objetivo es te empezar a a responderla lo más temprano posible, a buscar las personas que nos puedan responder, pero digo, actualmente debe estar pasando algo similar, o sea, como que si quieres También Daniel, por la hora intenta también votarte la pregunta ahí en el grupo de de WhatsApp de hotelería a ver si si alguien te la te la cacha, pero algo debe estar pasando en este momento. O sea, seguro que también deben tener alguna forma de identificar si eso es un producto nuevo que no estaba en los anteriores o y aún

**Daniel Enrique Rosas Esteban:** Sí, lo más lo más probable es que lo terminan creando directamente en el en el Oracle,

**Braejan David Arias Heregua:** así,

**Daniel Enrique Rosas Esteban:** ¿sí? Porque así es como funciona. Yo me encontré este producto,

**Braejan David Arias Heregua:** claro.

**Daniel Enrique Rosas Esteban:** pues lo añado aquí ta ta ta ta, y le hago la configuración de todo lo que ta ta ta es, pero en el Oracle,

**Braejan David Arias Heregua:** Tal cual.

### **00:43:56** {#00:43:56}

**Daniel Enrique Rosas Esteban:** pero esa funcionalidad no la tendríamos nosotros o sí es lo que vendríamos a

**Braejan David Arias Heregua:** Eh, exacto.

**Daniel Enrique Rosas Esteban:** buscar.

**Braejan David Arias Heregua:** Ahí quiero mencionar algo importante, es no olvidemos nuestro foco, que nuestro foco incluso ellos lo repiten mucho,

**Daniel Enrique Rosas Esteban:** Mhm.

**Braejan David Arias Heregua:** es todavía no se enfoquen en el LP porque eso, o sea,

**Daniel Enrique Rosas Esteban:** Exacto.

**Braejan David Arias Heregua:** bacano si esto se puede conectar a la RP, pues nuestro foco es eliminar el papel o al menos hacer que el papel vuelva obsoleto

**Daniel Enrique Rosas Esteban:** Mm.

**Braejan David Arias Heregua:** con nuestra solución. Entonces, yo mañana pregunto esto, pero yo siento que por ahora nos podemos ir con lo que hay. O sea, que básicamente sea la fuente de la verdad y que si no está el producto, bueno, nosotros podemos sugerir agregarlo, pero si me entiendes, como que no lo compliquemos todavía hasta que no tengamos de pronto una respuesta por ahí de la gerente.

**Daniel Enrique Rosas Esteban:** Sí,

**Braejan David Arias Heregua:** C.

**Daniel Enrique Rosas Esteban:** digamos que yo yo estoy pensando es en el módulo de administración del auditor porque recordemos no lo vamos a conectar al RP, por ende tiene que ser completamente independiente, por lo cual el auditor debería poder tener la potestad de hacer estas cosas que nosotros estamos diciendo.

### **00:44:57**

**Daniel Enrique Rosas Esteban:** Si el auditor se encuentra un producto que no está, entonces debería poder registrar el producto en el sistema o no. Esa es como lo que me genera a mí la

**Braejan David Arias Heregua:** De una, no, de una. Yo me llevo, la, o sea,

**Daniel Enrique Rosas Esteban:** duda.

**Braejan David Arias Heregua:** saco las preguntas acá que que que salgan de esta sesión y lo que te digo, trato de de ir a buscar la respuesta lo más temprano posible.

**Daniel Enrique Rosas Esteban:** Listo. Bueno, entonces continúo desarrollando la idea. Entonces, a mí me gusta mucho la idea de Adriana porque darle porque esa idea de tener unos parámetros iniciales, si bien nos genera una complejidad en un módulo extra de administración, le da a la inteligencia artificial unos lineamientos supercaros de los cuales no se puede salir y reduce un montón la carga de trabajo, las alucinaciones y la cantidad de tokens. Sí, porque es que es es duro porque tú le puedes decir, "Estoy en la bodega norte" y él puede empezar a alucinar de 10,000 maneras porque si en otro punto se llama existe otra bodega norte o él dice un punto X y luego entre más variables tenga que calcular la inteligencia artificial mayor es la probabilidad de alucinaciones.

### **00:46:06**

**Daniel Enrique Rosas Esteban:** Entonces, si bien nos va a generar una complejidad mayor en el módulo de administración para el auditor, nos va a beneficiar un montón en la parte operativa del procesamiento de la inteligencia artificial. No sé si están de acuerdo con ese pensamiento o con este análisis que estoy haciendo.

**Braejan David Arias Heregua:** Sí, yo estoy de acuerdo. M.

**Daniel Enrique Rosas Esteban:** ¿Listo? Y ya sería entonces básicamente nos enfocaríamos en una herramienta que debe ser preprogramada. por el auditor para poder iniciar hacer el inventario. ¿Sí me va a entender? Entonces el flujo no inicia aquí, sino que iniciaría acá, ¿no? Acá en este

**Braejan David Arias Heregua:** Sí,

**Daniel Enrique Rosas Esteban:** error.

**Braejan David Arias Heregua:** en el auditor, el auditor debe, como dices, preprogramar, prealistar.

**Daniel Enrique Rosas Esteban:** Exacto. El debe configurar la auditoría, básicamente.

**Braejan David Arias Heregua:** Listo.

**Daniel Enrique Rosas Esteban:** Listo. Es él debe hacer una configuración. inicial, que obviamente esta configuración inicial en este punto la vamos a hacer nosotros con los datos que recibimos, ¿cierto? Pero eventualmente la idea es que la puedan ir haciendo ellos cosa a cosa.

### **00:47:26**

**Daniel Enrique Rosas Esteban:** Entonces, de esta configuración inicial básicamente es recibir los datos, crear las bodegas o aprobar las bodegas, porque es lo que te digo, si él me pasa x cantidad de datos, yo lo que voy a hacer es ir a la lista de puntos de venta o puntos de almacenaje y luego voy a mirar bodegas y luego voy a mirar productos, etcétera, etcétera. y voy a voy a verificar que todo esté okay, que son 12 bodegas, entonces le van a salir a él ahí 12 bodegas, que son cuatro puntos de venta o cuatro hoteles. Le van a salir ahí cuatro hoteles. Sí, lo que él meta es la información que va a obtener. ¿Cuántos SKU tiene? Tantos. De

**Braejan David Arias Heregua:** y pero eso es parte de lo que queremos permitir en cual el auditor si el auditor

**Daniel Enrique Rosas Esteban:** acuerdo.

**Braejan David Arias Heregua:** pueda llegar y simplemente cargar un Excel que ya tiene o sea que ya tenemos definido que o sea el

**Daniel Enrique Rosas Esteban:** Esa.

**Braejan David Arias Heregua:** auditor tendría que garantizar que el Excel pues de cierta forma sí tenga la fuente la verdad porque lo va a subir

**Daniel Enrique Rosas Esteban:** Sí, básicamente es eso. Sí.

**Braejan David Arias Heregua:** pero ahí en el en el Excel sí están las bodegas y están como artículos por bodega creo es que no no he tenido la chance porque hasta ahora pude configurar mi equipo, pero sí quiero pasar eso a un supace y ver cómo se ve.

### **00:48:36** {#00:48:36}

**Braejan David Arias Heregua:** O sea, como tener una visual de cómo se ve.

**Daniel Enrique Rosas Esteban:** Entonces, básicamente sería eso, ¿sí me va a entender? De parte del auditor. ¿Qué más tendría entonces? ¿Dónde arrancaría realmente el flujo de trabajo después de la configuración inicial? Él tiene que crear como un acta de auditoría o un plan de auditoría, no sé cómo llamarlo, sería así como una especie de plan de auditoría. ¿Y qué es lo que tiene que hacer en ese plan de auditoría? Tiene que decir, seleccionar qué es lo que va a auditar y qué personas le van a auditar eso que él va a auditar. ¿Sí me dado a entender? Entonces,

**Braejan David Arias Heregua:** Yeah.

**Daniel Enrique Rosas Esteban:** aquí es donde él le va a decir, "Voy a tener cuatro operarios en Bodega Norte, auditándome Bodega Norte." Y este plan de auditoría va a ser el plan de auditoría de Bodega Norte, ¿de acuerdo? Y aquí entonces es donde arranca el flujo de trabajo de ingesta de información, pero primero debería haber una preparación del entorno de lo que va a pasar. ¿Por qué este plan de auditoría? Porque este auditor puede terminar auditando cinco puntos eh diferentes, cinco bodegas diferentes, ¿de acuerdo?

### **00:49:56**

**Daniel Enrique Rosas Esteban:** Y en esas cinco bodegas diferentes va a tener diferentes personas y va a tener diferentes

**Braejan David Arias Heregua:** Ok.

**Daniel Enrique Rosas Esteban:** hallazgos y va a tener diferentes anomalías, productos, etcétera, etcétera, etcétera, etcétera, y va a poder gestionar cada bodega de forma independiente sin que se le acumulen 300 folios de papel con nombre por espacio, sino que lo va a tener segmentado de esa manera.

**Braejan David Arias Heregua:** Va,

**Daniel Enrique Rosas Esteban:** Esto hasta ahí. Eh, pues estoy siendo claro, me estoy haciendo entender, no

**Braejan David Arias Heregua:** sí. Eh,

**Daniel Enrique Rosas Esteban:** sé.

**Braejan David Arias Heregua:** de de pronto es sí puedes detallar qué más iría en el plan de auditoría, o sea, eh, ejemplo, tú quisieras ser eh no sé, no estuvieran a Adriana y a mí como como las personas que vamos a ir a bodegas, ¿qué necesitas hacer en ese plan para que quede establecido de que Adriana y yo vamos a ir a esas bodegas?

**Daniel Enrique Rosas Esteban:** Listo. En el plan de auditoría, o sea, entonces, claro, ¿qué pasa en la configuración inicial? Asumo, perdón, me exalté esa parte.

### **00:50:58** {#00:50:58}

**Daniel Enrique Rosas Esteban:** Ev. quedar los usuarios que van a usar la herramienta, ¿cierto? O sea, hay que configurar quiénes son los usuarios que tiene por debajo este auditor, los que están disponibles para que este auditor asigne a X o y bodegas. Ahora, hay una duda acá que me surge y es, ¿el auditor asigna la gente a las bodegas o capaz es el supervisor de la bodega el que asigna la gente a las bodegas? Son dos. Esos son datos que no tengo porque entonces entraría una entonces entraría un tercer

**Braejan David Arias Heregua:** Va la la si quieres si sí si sí te invito a la

**Daniel Enrique Rosas Esteban:** actor. Si

**Braejan David Arias Heregua:** dinámica la siguiente.

**Daniel Enrique Rosas Esteban:** me

**Braejan David Arias Heregua:** Listo. Entonces tú dile, o sea, en la llamada como pregunta para la gerente de auditorías y lanzas la pregunta.

**Daniel Enrique Rosas Esteban:** listo.

**Braejan David Arias Heregua:** Va.

**Daniel Enrique Rosas Esteban:** Pregunta para la gerente del proyecto de hotelería.

**Braejan David Arias Heregua:** Hotelería. Yeah.

**Daniel Enrique Rosas Esteban:** ¿Cuántas personas están implicadas en el proceso de inventarios? Tenemos el rol de operador, que es la persona que hace la ingesta de datos y tenemos mapeado el rol de auditor, que es la persona que revisa la información de la ingesta de datos.

### **00:52:06**

**Daniel Enrique Rosas Esteban:** Sin embargo, necesitamos esclarecer cuál es la relación entre estos dos. El auditor es la persona que asigna los operadores para la actividad de inventario. O hay un supervisor adicional que es la persona encargada de decir qué operarios están haciendo el registro de X o y bodega.

**Braejan David Arias Heregua:** Listo.

**Daniel Enrique Rosas Esteban:** Listo.

**Braejan David Arias Heregua:** No.

**Daniel Enrique Rosas Esteban:** Esa sería como la el contexto completo de la pregunta. Entonces, claramente, hay que crear los usuarios que van a poder usar la herramienta de ingesta de información, ¿de acuerdo? Y ya. Entonces, por ahora voy a asumir que no hay un tercero involucrado. Voy a asumir que el rol de auditor es la persona que asigna las las personas para mapear la bodega. ¿De acuerdo?

**Braejan David Arias Heregua:** Vale,

**Daniel Enrique Rosas Esteban:** Entonces,

**Braejan David Arias Heregua:** yo creo también que por ahora digamos podemos irnos con la idea de porque nos han presentado solo esos dos perfiles, No.

**Daniel Enrique Rosas Esteban:** exactom. Listo. Entonces, ¿qué es lo que va a llevar el plan de auditoría o qué es lo que tiene el plan de auditoría? básicamente un periodo de tiempo, que es el periodo de tiempo en el que se realizó la auditoría, las personas que están llenando la información de ese plan de auditoría, que es cuando digo se le van a asignar x cantidad de operario y el plan de auditoría va a estar

### **00:53:34** {#00:53:34}

**Daniel Enrique Rosas Esteban:** asociado a un solo lugar al mismo tiempo. Si bien un operario puede estar incluido en varios planes de auditoría, la ingesta de información debería estar segmentada por lugar para no empezar a tener 20 pestañas diferentes, no tener una ingesta de información masiva que sea difícil de manejar para Yeah. inteligencia artificial. Listo. Bueno, lo que digo, este es el flujo que yo estoy planteando y este es como el análisis que estoy haciendo.

**Braejan David Arias Heregua:** Listo.

**Daniel Enrique Rosas Esteban:** No es nada final. Ustedes pueden aquí opinar todo lo que lo que gusten. Listo. Ahora sí, aquí entraría parte de este flujo que que veíamos. Aquí es donde podría empezar. Listo. Seleccionar bodega.

**Braejan David Arias Heregua:** No.

**Daniel Enrique Rosas Esteban:** Entonces sería claramente seleccionar una bodega porque como el operario puede tener diferentes planes de auditoría, lo que él lo que el operario seleccionaría no sería una bodega, sino qué plan de auditoría es el que va a estar realizando en ese momento. Si sí me hago entender cuál es la diferencia. No te escucho.

**Braejan David Arias Heregua:** Perdón. Sí,

### **00:54:48** {#00:54:48}

**Daniel Enrique Rosas Esteban:** Tienes,

**Braejan David Arias Heregua:** perdón que si me puedes repetir y qué pena contigo que me

**Daniel Enrique Rosas Esteban:** ¿no? Dale. O sea, que en el en el flujo de trabajo que tenemos acá hablamos de seleccionar

**Braejan David Arias Heregua:** distraje.

**Daniel Enrique Rosas Esteban:** bodega y cargar catálogo. Pero esta seleccionar bodega como tal no no sería un seleccionar bodega porque él no va a seleccionar una bodega, sino que va a seleccionar un plan de auditoría, el operativo, el operario. Claro.

**Braejan David Arias Heregua:** Okay,

**Daniel Enrique Rosas Esteban:** sino que el plan de auditoría va a estar asociado a una bodega, obviamente,

**Braejan David Arias Heregua:** entiendo.

**Daniel Enrique Rosas Esteban:** pero es es diferente porque puedes tener solamente tres planes de auditoría activos porque el auditor solamente te dijo que ibas a estar en bodega norte, bodega este y en la bodega subterránea. Ya está. No te dijo que te fueras a la bodega sur a hacer absolutamente nada. Por ende, usted no tiene la posibilidad de interactuar con el plan de auditoría de la bodega Sur porque usted no está

**Braejan David Arias Heregua:** Ah.

**Daniel Enrique Rosas Esteban:** asignado para hacer auditoría en la bodega sur. Listo. Ahí damos un mantenemos un control operativo estricto sobre las personas que van a tener injerencia en el proceso de auditoría o en el proceso de inventarios para que sea fácil de esclarecer quién está haciendo qué ingesta de

### **00:55:58**

**Daniel Enrique Rosas Esteban:** información.

**Braejan David Arias Heregua:** De acuerdo, me parece

**Adriana Durand Calle:** Eh,

**Braejan David Arias Heregua:** Sí.

**Adriana Durand Calle:** no sé si entendí bien la idea, o sea, el operador tendría en su en su app las todas las bodegas asignadas en ese día, ¿no? Entonces, de tal manera que no haya de su parte ninguna selección en cuanto a a discrecional, digamos, ¿no? Eh, así es como yo lo entiendo. O sea, ya tendría todas las las bodegas asignadas, ¿no? O no.

**Braejan David Arias Heregua:** A ver cómo lo entiendo. Ya. Y y y Dani, ¿me corriges? O sea, lo que tú establecerías sería en efecto un plan eh plan de de auditoría que puede tener una o varias bodegas y ese plan de auditoría va a tener determinadas personas que van a trabajar en esas bodegas. Y ese plan de auditoría, además, tiene un tiempo o un periodo de de, o sea, el auditor lo puede determinar o lo puede activar o desactivar. Entonces, si yo fui asignado dentro de un plan de auditoría con N Bodegas, cuando entre a la aplicación voy a ver ese plan de auditoría activo en donde yo estoy.

### **00:57:16**

**Braejan David Arias Heregua:** Incluso podría estar en dos planes de auditoría distintos, pero yo lo que voy a ver es ese plan de auditoría y el plan de auditoría sí me va a indicar qué bodegas voy a poder ir a a mirar. C.

**Daniel Enrique Rosas Esteban:** Exacto. Básicamente eso. Quisiera hacer la aclaración de que para mí un plan de auditoría debería estar ligado únicamente a una bodega en específico. Obviamente en el transcurso lo podemos mirar, pero cada, o sea, el auditor debería ser bastante controlado en el proceso, es decir, plan de auditoría, bodega uno, plan de auditoría, bodega dos, plan de auditoría bodega 3, etcétera. y la y el operario solamente va a tener acceso o va a poder visualizar los planes de auditoría que estén en los que él esté implicado, de tal manera de que le quitamos la posibilidad completamente de ir a meter mano en la bodega cuatro si él no estáado por absolutamente nadie para ir a hacer registro de la bodega cuatro. Listo, eso reduce la cantidad de errores humanos que puede tener la herramienta y mejoramos bastante el flujo del proceso, tenemos muy buen control, etcétera, etcétera, y entre menos opciones tenga la persona, es muchísimo mejor.

### **00:58:36** {#00:58:36}

**Braejan David Arias Heregua:** De acuerdo. Creo que el papel aguanta todo y precisamente por eso se se presentan tantos problemas.

**Daniel Enrique Rosas Esteban:** Exacto. Entonces, digamos aquí los cuatro. Entonces ya

**Braejan David Arias Heregua:** No.

**Daniel Enrique Rosas Esteban:** seleccionan auditoría ahí. Bueno, perdón que haga esto tan horrible, pero estoy haciendo más.

**Braejan David Arias Heregua:** No se preocupe, Daniel,

**Daniel Enrique Rosas Esteban:** Listo.

**Braejan David Arias Heregua:** estás haciendo un gran trabajo.

**Daniel Enrique Rosas Esteban:** Entonces, aquí ya él selecciona la auditoría y aquí es donde ahora sí arrancaría el proceso de ingesta de información por parte del operario. ¿De dónde va a salir la información? De acá de esta configuración inicial que hizo el auditor. ¿Sí me a entender? Entonces, el auditor ya cargó las bodegas, ya cargó absolutamente todo, ya revisó que los productos sí corresponden a lo que es usualmente a lo que usualmente está en esa bodega. Y ya cuando él selecciona el plan de auditoría, va a tener acceso a a toda esa información. ¿Cuáles son los SKU? ¿Cuáles son las unidades? ¿Cuáles son los productos?

### **00:59:42** {#00:59:42}

**Daniel Enrique Rosas Esteban:** ¿Cuál es el comportamiento? Porque obviamente cuando haga la carga inicial podemos hacer una especie de modelo científico, estadístico, etcétera, etcétera, que vaya sacando unos parámetros iniciales y todo eso ya va a estar cargado por detrás en la herramienta. ¿De acuerdo? Aquí solamente estamos haciendo el modelo de usabilidad.

**Braejan David Arias Heregua:** De acuerdo.

**Daniel Enrique Rosas Esteban:** ¿Listo? Entonces, cuando él ya selecciona hacer la auditoría, un momentico, voy a pasar esto por acá. Eh, voy a imaginarme que esta es la bodega, ¿no? La idea no sería llegar hasta un punto de mapear las secciones de la bodega porque, o sea, si bien es viable y si bien se podría hacer, decir sección uno, sección dos, sección tres, incluso acotarlo muchísimo más, es añadirle ya más subniveles a la herramienta,

**Braejan David Arias Heregua:** complejizamos.

**Daniel Enrique Rosas Esteban:** etcétera, etcétera.

**Braejan David Arias Heregua:** Sí,

**Daniel Enrique Rosas Esteban:** Y esto puede ser muy variable porque hoy esto la bodega puede estar así y mañana la bodega puede estar ya en horizontal, ¿cierto?

**Braejan David Arias Heregua:** yo creo que pero igual sí pueden ser cosas como que se pueden mencionar en el pitch que se pueden eh

### **01:00:42**

**Daniel Enrique Rosas Esteban:** Entonces,

**Braejan David Arias Heregua:** el producto se puede escalar de esta manera y de esta manera o bueno, algo

**Daniel Enrique Rosas Esteban:** exacto. Listo.

**Braejan David Arias Heregua:** muy

**Daniel Enrique Rosas Esteban:** Entonces, de usualmente el inventario lo hacen en un orden específico.

**Braejan David Arias Heregua:** cosa como Ciero.

**Daniel Enrique Rosas Esteban:** ¿Listo? Pero ese orden específico puede traer muchas anomalías. Entonces, así es como de normal se organiza una bodega o lo que yo he visto en diferentes partes, como organiza una bodega. Todos los productos de los similares los ponen de aquí para allá, ta ta ta y los productos iguales se almacenan siempre en el mismo lugar. Es muy extraño que yo tenga el un producto aquí. y de la nada me vuelvo a encontrar este producto acá. Eso es una anomalía usualmente dentro del proceso de auditoría, porque es como, "Vení, ¿por qué te complicas tanto teniendo aquí, teniendo allá, teniendo aquí, teniendo acá en dos lugares diferentes del depósito, agarre y traiga estos que tiene allá y los pone acá, ¿cierto?" Entonces, usualmente lo que va a pasar es que él va va registrando de aquí para allá, de allá para acá, luego vuelve hacia acá, luego vuelve hacia acá, luego vuelve hacia acá, luego vuelve hacia acá y luego vuelve hacia acá.

### **01:02:02** {#01:02:02}

**Daniel Enrique Rosas Esteban:** ¿Listo? Así es como de normal yo he visto que se realizan los inventarios. La experiencia propia que yo tengo realizando inventarios. ¿Qué pasa en cocina? Es diferente. Es que en cocina la operatividad se va al traste, ¿cierto? O sea, ahí es un poco más despelotado, pero a lo que quiero llegar es que él va a empezar de arriba hacia abajo haciendo un inventario. Entonces, la pregunta mía es aquí si ya es el cómo nosotros pretendemos que él empiece a ser ingesta de información separando producto por producto o que hable de corrido y vaya dictando de corrido y la IA vaya quedando creando los registros.

**Braejan David Arias Heregua:** Buena pregunta. Yo no sé si tú has trabajado con real time de audio. Es que ya lo trabajé hace un año atrás y lo trabajé y uy Y

**Daniel Enrique Rosas Esteban:** Es horrible. Yo lo trabajé una vez y es horrible. M.

**Braejan David Arias Heregua:** es doloroso porque el tema es que tienes que implementar estos silencios, tienes que implementar varias cosas de de saber si el humano está hablando, si la va a hablar, las interrupciones son en su momento fueron tremendamente dolorosas.

### **01:03:15**

**Braejan David Arias Heregua:** Yo asumiría que es mejor audio por producto, ¿sabes? Eso es como lo que a mí me suena. No sé a ti cómo te suena también. Yeah.

**Daniel Enrique Rosas Esteban:** Yo por practicidad me gustaría real time porque para el usuario es muchísimo mejor. El problema es que a nivel técnico se complejiza muchísimo porque si son dos personas las que están haciendo el inventario, una dictando y la otra ingresando información y en medio de eso están echando chisme, le cuento un cuento. Entonces, yo pasaría completamente del

**Braejan David Arias Heregua:** Sí, hay un componente humano que hay un componente humano que no tuve en cuenta y tienes toda la razón.

**Daniel Enrique Rosas Esteban:** re.

**Braejan David Arias Heregua:** Al final uno está trabajando, pero uno está hablando de otras cosas constantemente.

**Daniel Enrique Rosas Esteban:** Exacto. Entonces, yo haría eso. Entonces, ¿qué ocurre? Viene la pregunta del millón. Él debe seleccionar el producto al que le va a hacer la modificación. Es decir, nos imaginamos esto como esto. Yo estoy compartiendo ventana o estoy compartiendo pantalla.

**Braejan David Arias Heregua:** No, estás estás compartiendo todo.

### **01:04:16** {#01:04:16}

**Daniel Enrique Rosas Esteban:** Ah, vale,

**Braejan David Arias Heregua:** Sí, es el

**Daniel Enrique Rosas Esteban:** listo. Entonces, eh puede ser esto así, ¿sí? se crea esta lista completa con todos los productos que hay

**Braejan David Arias Heregua:** cambio.

**Daniel Enrique Rosas Esteban:** actualmente y entonces él tiene que ir seleccionando uno a uno producto es el que está mapeando o él va dictando y que la Iuma cuál es el producto que está mapeando.

**Adriana Durand Calle:** No.

**Braejan David Arias Heregua:** Pues es que, o sea, yo me lo imaginaba así. Lo segundo, retomemos de pronto más lo de la hoja, ¿cierto? Yo todavía no he visto escrito y pedí eso,

**Daniel Enrique Rosas Esteban:** Mhm.

**Braejan David Arias Heregua:** pero tengo entendido que es como yo escribo el producto, pero no sé si ahí, por ejemplo, está el SKU del producto, ¿no? No creo que lo mencionabas el ejemplo de las lechugas, por ejemplo, pues tenga un SKU o algo ahí. Entonces, yo sí creo que escriben como tres libras de lechuga y y el tema es cómo está cómo están haciendo ese match, pues ahí es donde está la otra persona corroborando, ¿cierto?

### **01:05:18**

**Braejan David Arias Heregua:** Pero,

**Daniel Enrique Rosas Esteban:** Mhm.

**Braejan David Arias Heregua:** o sea, si es así y si lo que queremos es es ayudar, yo sí siento que la IA, sé que es complejo, pero la IA debería identificar el producto o hacerle saber al usuario que no pudo identificarlo para que el usuario lo pueda buscar o seleccionar. Eso es como se me ocurre en estos momentos. No sé.

**Adriana Durand Calle:** O sea,

**Braejan David Arias Heregua:** Mana

**Adriana Durand Calle:** estaba pensando en que la opción Eh, digamos, o sea, el orden lógico es el de iniciar un inventario, es es como está estructurado Yeah. almacén, ¿no? Que es lo que este señaló Daniel, pero eh por eso yo, o sea, yo lo yo no lo veía como real time porque digamos eh no sé, o sea, no se me había ocurrido, era más, digamos, siguiendo el orden eh de la de de la estructura de de cómo estaba diseñado el la bodega en que este se podía ir este indicando, o sea, el operador indicaba los productos que iba encontrando, ¿no? Pero, o sea, no sé que tan viable sea la primera opción que que dijo Daniel. Este, no sé, me parece más práctica, eh, pero más que la segunda,

### **01:06:56**

**Braejan David Arias Heregua:** Vale, si quieres retomamos las dos opciones de nuevo porque yo también ya estoy un poquito confundido.

**Adriana Durand Calle:** ¿no?

**Braejan David Arias Heregua:** Voy lo mismo, si algo me corrigen. La primera opción que yo veo es que tal cual como como voy con el papel, simplemente voy a ir y voy mirando lo que digo. una billetera. Entonces le escribo, hay una billetera y envío.

**Adriana Durand Calle:** Mhm.

**Braejan David Arias Heregua:** Y ahí en ese momento hace la búsqueda de del producto que tengo entendido que que están asociados

**Adriana Durand Calle:** H

**Braejan David Arias Heregua:** a a también a las a los almacenes, o sea, como que hay un stock en el almacental y pues digamos que esa información también podría llegar casi que segmentada, que ahí era donde yo decía, "Oye, ¿y si no está ese producto ahí, ¿qué?" Cierto,

**Daniel Enrique Rosas Esteban:** Exacto. Mm.

**Braejan David Arias Heregua:** pero tenerla como la llamada abierta durante todo el rato, ¿no? Eso lo que sí veo que

**Daniel Enrique Rosas Esteban:** Ah, yo sé que es muy práctico porque yo lo hago, o sea, yo cuando voy a tirarle un pron super largo a la lo que hago es que me pongo de texto a voz en la en el celular y empiezo a soltarle ahí todo lo que quiera.

### **01:07:57** {#01:07:57}

**Daniel Enrique Rosas Esteban:** Pero ahí hay un montón de cosas que la no tiene por qué tener en cuenta cuando empiezo a divagar o cuando alguien me habla y yo continúo grabando, etcétera, etcétera. Y ese procesamiento lo asume actualmente mi suscripción de $20, ¿cierto? que incluye un montón de cosas, pero cuando estamos hablando de pago por token, cada token cuesta y cada token es una variable más de error que puede introducirse al modelo y cuando está eso empiezan las alucinaciones y no hay forma. Entonces sí, o sea, para mí el real time está completamente descartado, tiene que ser un botón de push. Ya presiono, hablo, suelto, termina, va, analiza y crea. Ahora, la pregunta mía es, digamos, hay dos opciones para poder hacer esa modificación o ese seguimiento. está la opción dura, o sea, perdón, es que en inglés sería la hard option La esto es como tiene que ser,

**Braejan David Arias Heregua:** Sí.

**Daniel Enrique Rosas Esteban:** así es como es que sería lo que va a ver el usuario. Es todos los ítems que tiene en el inventario o que están mapeados en el inventario de ese lugar. Y él lo que va a ir haciendo es seleccionando cada ítem que está mapeado en ese lugar y hablarle y decirle, "Hay kil y antes habían 40 o antes habían 10 y ya la herramienta se encarga de sumar, restar, multiplicar, dividir, hacer lo que tenga que hacer para que la cantidad de ese de ese SKU quede correctamente, ¿cierto?

### **01:09:37** {#01:09:37}

**Daniel Enrique Rosas Esteban:** Entonces ahí, ¿qué es lo que se le estaría ahorrando el tiempo al usuario? se le ahorraría el tiempo es en hacer el cálculo de suma, resta, multiplicación, división y asignar el valor porque ahora lo dicta, pero él todavía tendría que ir manualmente dentro de la herramienta a buscar el producto exacto que es para añadirlo. Si el producto no está, entonces se le debería crear la opción de añadir registro inexistente, descripción del producto, creación de no sé qué, ta ta ta ta ta. y tendríamos un inconveniento, o sea, se mejora la precisión de los datos. Teóricamente sí, porque ahora lo hacen a través de un sistema. Se ahorra tiempo operativo, capaz si sí, porque ya no hay que hacer un traslado completo de información al papel, a lo digital, sino que estamos directamente mapeando lo digital. Pero el trabajo de buscar e identificar y aprenderse el inventario de memoria porque no es capaz de de recordar todos los SKU o si es lechuga, no sé, arrugadita o si es lechuga lisa o si es lechuga roja o si me va a entender. Todas esas cosas todavía lo tendría que hacer él manualmente. Y la segunda opción queé pena, se me descargó la cámara.

**Braejan David Arias Heregua:** No, no, no hay no

### **01:10:59**

**Daniel Enrique Rosas Esteban:** Y la y la segunda opción sería que él pueda mandarle un audio a la IA, o sea, que él genere el audio desde la herramienta y con ese audio desde la herramienta, la IA cree el registro de modificación, un \+ 10 kg, un menos 20 kg,

**Adriana Durand Calle:** Yes.

**Daniel Enrique Rosas Esteban:** un no sé qué ta ta ta. ¿Sí me va a entender?

**Braejan David Arias Heregua:** Yo yo de pronto ahí estoy perdido en esa parte de los negativos. Creo que tú lo acabas de mencionar bien y es, o sea,

**Daniel Enrique Rosas Esteban:** y

**Braejan David Arias Heregua:** sé dónde va el punto y no lo quiero cortar porque, o sea, yo lo que he hecho en experimento es que le he hecho una Coca-Cola y él, o sea, él va y mira en el en el inventario y me dice, "No sé, me salieron tres Coca-Colas de litro de 350 o o qué." Sí, o sea, como que la eso lo he hecho a manera de ejemplo y me ha funcionado y sé que las sillas en este momento están en la capacidad, pero La operación es lo que no me queda claro,

**Adriana Durand Calle:** M.

**Braejan David Arias Heregua:** es si quieres lo miramos ahorita, pero si no me queda claro cómo le daría el negativo, o sea, en qué momento el usuario cuando hace con el papel está sumando y restando.

### **01:12:08**

**Braejan David Arias Heregua:** No.

**Daniel Enrique Rosas Esteban:** No es que de normal sí, o sea, yo te lo juro, de normal tú lo que vas haciendo y es que es complejo porque tú tienes, te lo voy a poner en términos de Coca-Cola, como lo dijiste, tú tienes aquí al inicio, estás viendo mi pantalla, ¿cierto? No dejes de compartirlos.

**Braejan David Arias Heregua:** Estoy viendo las gráficas.

**Daniel Enrique Rosas Esteban:** Listo. Entonces,

**Braejan David Arias Heregua:** Sí,

**Daniel Enrique Rosas Esteban:** tú de normal aquí te encontraste 10 Coca-Colas de litro, ¿cierto?

**Braejan David Arias Heregua:** sí. M.

**Daniel Enrique Rosas Esteban:** Y tú le y tú cómo hiciste el registro, tú agarraste y le dijiste, o sea, lo que lo que estamos planteando es tú vas y le dices a la IA 10 Coca-Colas de litro, pum, y la IA te crea el registro donde dice 10 Coca-Colas de litro, ¿sí o no? Pero luego tú vas avanzando por acá, por acá, por acá,

**Braejan David Arias Heregua:** Sí.

**Daniel Enrique Rosas Esteban:** por acá y luego aquí te encuentras tres Coca-Colas de litro. Cuando uno está en el papel, lo que uno hace es que tacha, tacha y pone el 13 Coca-Colas de litro.

### **01:13:01**

**Adriana Durand Calle:** M.

**Daniel Enrique Rosas Esteban:** ¿Sí me va a entender?

**Braejan David Arias Heregua:** Ja.

**Daniel Enrique Rosas Esteban:** Pero probablemente lo que puede llegar a pasar en el audio es tres

**Braejan David Arias Heregua:** Yeah.

**Daniel Enrique Rosas Esteban:** Coca-Colas de litro en lugar de las 10 que habían anteriormente. Entonces ahí es cuando digo, ¿qué hace la IA? Suma, resta, multiplica, divide. El usuario debe editar el registro anterior, borrar el audio y decir otra cosa o eliminarlo y decirme cuántas Coca-Colas hay de verdad o qué.

**Braejan David Arias Heregua:** Va, entiendo, ¿no? Yo lo lo que yo alcancé a hacer como una poc eh sumaba es que, o sea, teníamos como el el ejemplo, digamos, de un restaurante, ¿no? Tú pides y haces un primer pedido, pero de repente quieres algo más adicionales y demás. Entonces, como que inicialmente cuatro Coca-Colas y al rato una Coca-Cola nueva, otra Coca-Cola para la mesa 5\.

**Daniel Enrique Rosas Esteban:** Exacto. Sí,

**Braejan David Arias Heregua:** Vale,

**Daniel Enrique Rosas Esteban:** claro.

**Braejan David Arias Heregua:** pero al final te Claro.

**Daniel Enrique Rosas Esteban:** Al final te suma.

### **01:14:08** {#01:14:08}

**Daniel Enrique Rosas Esteban:** Pero y ahora te pongo el caso contrario.

**Adriana Durand Calle:** M.

**Daniel Enrique Rosas Esteban:** Dentro de los inventarios existe una mecánica que se llama el reconteo. Tú vas a entregar y le dijiste a tu jefe, eh, o a la persona que estaba contigo. Me quedaron dudas, la verdad. No sé si conté bien él ese o no. Y eso puede pasar cuando uno está por acá. Esa mecánica existe en la operación y va y cuenta hacia atrás y va y se devuelve y cuenta. Ah, par, imagínate que no eran 10 Coca-Colas, sino nueve. y viene y con todas sus nueve Coca-Colas acá y después va al final y vuelve y añade entonces ahora tres Coca-Colas porque si eran nueve de atrás, no 10 y luego tres. O sea, si me a entender, hay una mecánica que nosotros en lenguaje natural es fácil de de identificar de qué estamos hablando. cuando lo metamos en La en la qué en la herramienta tenemos también que saber cómo se van a hacer ese tratamiento de información o cómo debe la inteligencia artificial o la creación de registros hacer ese tratamiento de información porque esa mecánica en la operación es muy normal de los operarios.

**Braejan David Arias Heregua:** entiendo.

### **01:15:18**

**Braejan David Arias Heregua:** No, no ha entendido lo de los negativos. O sea, incluso por eso puede dar negativo. Puede puede dar el caso de que en el reconteo se hayan sacado íems por alguna razón.

**Daniel Enrique Rosas Esteban:** Sí, puede ser que el ítem no esté vencido, entonces haya que tirar un acta de vencimiento del ítem. Tú agarras, dices, vamos a desechar x cantidad de cosas. Y se saca. Y para el inventario que se manda al final, tú mandas la cantidad real que quedó y le mandas un acta de eliminación al auditor para que sepa que lo eliminaste. Pero como no lo mandas en las actas de los inventarios, en este punto, en este punto y la herramienta que nosotros estamos construyendo, no tiene contempladas esas actas de eliminación de inventarios. ¿Sí me va a entender?

**Braejan David Arias Heregua:** Sí.

**Daniel Enrique Rosas Esteban:** Entonces, claro,

**Braejan David Arias Heregua:** M.

**Daniel Enrique Rosas Esteban:** puede terminar siendo negativo, puede bajar a cero, o sea, hay una mecánica ahí bastante compleja a la hora de uno tratar de imponer una forma de usar la herramienta a un usuario, más que todo porque tiene inteligencia artificial y todos interactuamos con la como nos da la gana.

### **01:16:20**

**Braejan David Arias Heregua:** No, total. Y por más que haya un onboarding, eh, los humanos en esto somos muy muy distintos.

**Daniel Enrique Rosas Esteban:** Bien.

**Braejan David Arias Heregua:** Muchas de las personas creen que esto es conciencia y de verdad le hablan como hablarle a cualquier otro y eso lo revienta a veces. O sea, uno de técnico le habla técnico y eso es lo que pasa, pero las personas no técnicas seguro que van a seguir manejando su lenguaje natural.

**Daniel Enrique Rosas Esteban:** Exacto. Entonces, bueno, digamos

**Braejan David Arias Heregua:** Bueno, yo yo creo que también voy a anotar esa pregunta y es preguntarle mañana a la a la gerente

**Daniel Enrique Rosas Esteban:** que

**Braejan David Arias Heregua:** de de hotelería eh cómo se manejan los casos de reducciones, digamos, para vencimientos o sobre todo vencimientos o cosas que ya no van, que se tienen que sacar del inventario. si firman un acta adicional, si lo ponen ahí mismo en el papel, preguntar cómo cómo se maneja

**Daniel Enrique Rosas Esteban:** si lo van a incluir en esta primera etapa,

**Braejan David Arias Heregua:** esto,

**Daniel Enrique Rosas Esteban:** si quieren que se incluya en esta primera etapa del reto porque no está por escrito. Entonces,

**Braejan David Arias Heregua:** ¿vale?

### **01:17:16** {#01:17:16}

**Braejan David Arias Heregua:** Sin embargo,

**Daniel Enrique Rosas Esteban:** etcétera.

**Braejan David Arias Heregua:** sí pensemos la opción de la que contó mal o

**Daniel Enrique Rosas Esteban:** Claro. Sí, si contó mal. Venga,

**Braejan David Arias Heregua:** cómo cómo lo cómo lo o sea,

**Daniel Enrique Rosas Esteban:** modifíqueme eso.

**Adriana Durand Calle:** H

**Braejan David Arias Heregua:** no estoy diciendo que vaya a ser la mejor solución, pero pues que evidentemente me enfrenté a esto y es cuando el mesero hizo mal la anotación y entonces no eran tres, eran cuatro. En este caso nos iba mejor hacer borrón y cuenta nueva porque es como, okay, ¿quieres corregir todos los ítems de Coca-Cola, por ejemplo? Sí, sí. Listo. Entonces, vale, dime cuáles son los nuevos o arranquemos de nuevo. En este caso no tenía contemplado el escenario. Es que esto es como si fueran dos mesas aparte, ¿eh? Pero sí,

**Adriana Durand Calle:** Yeah.

**Braejan David Arias Heregua:** sí siento que que el editar puede ser más problemático, pero no lo sé, la verdad. No lo sé.

### **01:18:03**

**Braejan David Arias Heregua:** O sea,

**Daniel Enrique Rosas Esteban:** No sé,

**Braejan David Arias Heregua:** pues al final para

**Daniel Enrique Rosas Esteban:** esos esos casos tendríamos que evaluarlos directamente con testing porque realmente no sé cómo

**Braejan David Arias Heregua:** una

**Daniel Enrique Rosas Esteban:** llevarlo a cabo a nivel de que ella interprete correctamente el 100% de las veces lo que

**Braejan David Arias Heregua:** listo.

**Daniel Enrique Rosas Esteban:** se le está tratando de decir. Eso es muy difícil cuando tú le dices,

**Braejan David Arias Heregua:** Vale,

**Daniel Enrique Rosas Esteban:** "Edíteme esto."

**Braejan David Arias Heregua:** ¿sabes que sí podemos hacer? Total, sí. Bueno, sí podemos hacer también una especie si alcanza el tiempo,

**Daniel Enrique Rosas Esteban:** Durísimo.

**Braejan David Arias Heregua:** un onboarding rápido de de hacia el usuario, hacia el bodeguero final, que es como lo más claro posible, trata de hablar pausado, como cosas que sé que pueden ayudar para que esto se confunda menos.

**Daniel Enrique Rosas Esteban:** Listo. Bueno,

**Adriana Durand Calle:** O sea,

**Daniel Enrique Rosas Esteban:** quisiera continuar.

**Adriana Durand Calle:** una pregunta chiquitita, o sea, digamos que, o sea, nos ayudaría un montón tener el manual, ¿no?, su proceso, pero eh si hablamos de una modificación eh o sea, podría eh claro, ya luego se se testeá todo, pero o sea, no se me ocurre decirle, quiero hacer una corrección y final, o sea, digamos que cuando la eh IA escuche corrección o modificación o palabras similares,

### **01:19:20**

**Adriana Durand Calle:** se se detenga, ¿no?, a a digamos a a preguntar, digamos, o sea, que sea la entrada para que en casos de no como esas incidencias de corrección, modificación, añadir, etcétera, eh pueda iniciarse con con una solicitud a la a la IA, ¿no? O sea, podría ser una salida. Finalmente, como te digo, creo que el manual nos ayudaría un montón, eh, pero este puede ser hay una una opción

**Braejan David Arias Heregua:** Sí, pues yo lo yo lo complemento. es como al final eh si se sabe la persona que lleva registrado hasta el momento, o sea, como que lo que tendría que editar sería también basado en el plan de de auditoría que esté haciendo y no creo que haya,

**Daniel Enrique Rosas Esteban:** Ok.

**Braejan David Arias Heregua:** o sea, pues sí pueden haber muchos ítems, pero digo, si necesito hacer una corrección quizás me puede mostrar y decir, "Mira, esto es lo que has registrado hasta el momento, ¿cuál es la que necesitas corregir?" y bueno, podría corregirla, pero sí, eso es como lo que yo complementaría. Sin embargo, Daniel, creo que tú de cierta forma no nos has dicho cómo lo ves también, o sea, cómo cómo lo planteas tú esas ediciones.

### **01:20:47** {#01:20:47}

**Adriana Durand Calle:** Hm.

**Daniel Enrique Rosas Esteban:** Listo. Entonces, conto, selecciona el plan de auditoría y empieza a hacer su diálogo. Recordamos que el diálogo No va a ser en tiempo real, va a ser en shorts, ¿cierto? En audios pequeños, ¿sí o no?

**Braejan David Arias Heregua:** Boys

**Adriana Durand Calle:** Sí.

**Daniel Enrique Rosas Esteban:** Ahora, bueno, se llama Ch. Silencio. E entonces, estas voic pueden tener una peculiaridad. ¿Cuál es la peculiaridad? Nosotros vamos estamos tratando de asumir que el usuario me va a pasar una nota de

**Adriana Durand Calle:** Oh.

**Daniel Enrique Rosas Esteban:** voz por cada SK. Ese es el modelo inicial que nosotros estamos planteando antes de de continuar con el resto de modificaciones y de cosas.

**Braejan David Arias Heregua:** Pero el el usuario va a estar el el SKU,

**Daniel Enrique Rosas Esteban:** No,

**Braejan David Arias Heregua:** ¿no?

**Daniel Enrique Rosas Esteban:** el usuario lo que te va a decir es 3 kg de lechuga. Pum,

**Braejan David Arias Heregua:** y y pero la I ahí en ese punto va a buscar y va a decir,

**Daniel Enrique Rosas Esteban:** corto.

**Braejan David Arias Heregua:** "Este es el SKU y lo va

**Daniel Enrique Rosas Esteban:** Exacto.

### **01:21:59**

**Braejan David Arias Heregua:** a

**Daniel Enrique Rosas Esteban:** Ese ese es el ideal que estamos planteando nosotros o el modelo de funcionamiento que estamos planteando nosotros. ¿Correcto?

**Braejan David Arias Heregua:** Sí.

**Daniel Enrique Rosas Esteban:** Listo. Ahora, ¿qué ocurrirá cuando el usuario me diga 2 kg de tomate, 4 kg de papa y 3 kg de lechuga?

**Braejan David Arias Heregua:** La idea es que lo separe y los identifique.

**Daniel Enrique Rosas Esteban:** Ah, cierto.

**Braejan David Arias Heregua:** Sí. M.

**Daniel Enrique Rosas Esteban:** La idea sería eso. Entonces, tenemos que pensar en un control de tiempo. ¿A qué me refiero? Entre más largo sea el procesamiento de voz, más errores, más complejidad, más tokens, más x cantidad de cosas. Entonces, cuando hablamos de cuando dije shorts o voice notes, hablamos de un tiempo delimitado para el audio que la el usuario vaya a mandar a la herramienta.

**Braejan David Arias Heregua:** Genial. Está está genial esa idea.

**Daniel Enrique Rosas Esteban:** ¿Listo? Y la herramienta debe tener la capacidad de separar, hacerle un split a la cantidad de elementos de los que él está hablando. Aquí hay que hacer un onboarding fuertísimo y eso habrá que explicarlo en el pitch, el cómo se usa, el cuál es la capacidad máxima probada, obviamente, porque la idea, cuando les dije en la mañana, el tema de las de las pruebas es para esto, para testear todos estos puntos de llevar la herramienta hasta el fallo y tener una matriz completa de pruebas para poder presentar esa matriz de pruebas.

### **01:23:39** {#01:23:39}

**Daniel Enrique Rosas Esteban:** tanto por cento de fiabilidad en esto, tanto por de fiabilidad en esto, falla aquí, falla aquí, esto es lo que no es capaz de hacer, etcétera, etcétera, etcétera. Llevamos a costos toda esa val. ¿Listo? Pero entonces eso sería con esto. ¿Qué es lo que va a hacer él cuando reciba esta información? Yeah. la va a convertir en registros separados.

**Braejan David Arias Heregua:** Sí.

**Daniel Enrique Rosas Esteban:** Esa sería la mecánica de trabajo. ¿Listo? Para cada SKU, obviamente la IA va a sacar eh el SKU de forma automática. Listo. Y va a tener como todos esos registros aquí. Ahora el usuario debe poder editar esos registros, ¿sí o no?

**Braejan David Arias Heregua:** Sí, o sea, hoy se le permite y lo va a extrañar si siamos eso porque hoy a pesar de que de que sea tachones y lo que sea,

**Daniel Enrique Rosas Esteban:** Sí.

**Braejan David Arias Heregua:** se le permite esa equivocación, esa corrección de equivocación, por decirlo así.

**Daniel Enrique Rosas Esteban:** Listo. Entonces, la pregunta mía viene acá. Hay que determinar cuál es el alcance del modelo de inteligencia artificial después de recibir un audio.

### **01:25:06**

**Daniel Enrique Rosas Esteban:** Porque si le damos los cuatro alcances a los modelos de inteligencia artificial, lo que les digo, entre más aristas hay, más probabilidad de error cuando se trabaja con modelos de lenguaje natural. Si yo parametrizo para que el modelo de inteligencia artificial únicamente pueda crear los registros, va a ser s va a ser superfácil para el modelo saber qué es lo que tiene que hacer. Yo cuando un usuario le dice, si el usuario le dice, "Ay, es que no eran tantas, sino tantas, podemos parametrizar para que se cree otro registro en lugar de que se modifique o se elimine el que ya tiene y luego se agrupen, etcétera, etcétera." Y se le da un manejo. Si yo le digo a la IA el create, replace, edit y delete, entonces crear, reemplazar, editar y eliminar se puede hacer un lío. Yo no digo que no funcione bien porque los modelos de hoy en día son muy buenos y pueden darle muy buen manejo a las cosas. Simplemente digo que la tolerancia al error de nosotros debería estar por debajo del 1%. para que esto sea un cambio de paradigma significativo para

**Braejan David Arias Heregua:** Sí,

**Daniel Enrique Rosas Esteban:** ellos.

**Braejan David Arias Heregua:** pues yo creo, bueno, yo creo que no ponerle el permiso a la para que pueda eliminar sí va a ser fatal, ¿eh?

### **01:26:33** {#01:26:33}

**Braejan David Arias Heregua:** No, es que eso sí sale mal todavía, o sea, como que no hay a pesar de que el usuario yo le diga como esto, ¿no? No sé, Daniel que y Adriana que qué se les ocurrió en estos casos. Yo siempre hablo del borrón y cuenta nueva porque es la del ingeniero. Es como a este registro me quedó mal o por lo que sea. Por ejemplo, dije lo que hay, me sacó tres, pero de los tres uno estaba mal. Yeah. Entonces es como que gráficamente yo pueda darle a un botoncito de borrar y vuelvo otra vez y puch el botón y hola, es que eran tantos de esto y ya como que solo voy a enviar el pedacito de audio ya con lo que quiero corregir.

**Daniel Enrique Rosas Esteban:** Exacto.

**Braejan David Arias Heregua:** Yeah.

**Daniel Enrique Rosas Esteban:** Entonces, a eso era lo que iba yo, a lo que quería llegar, o sea, como toda esta lógica o plantearles toda esta lógica para llegar hasta este punto. El audio o los shorts de audio únicamente sean para añadir productos. Si usted se equivocó añadiendo un producto si quiere modificar algo del producto anterior, entonces vaya a ese registro específico, elimínelo y vuélvalo a registrar.

### **01:27:49** {#01:27:49}

**Daniel Enrique Rosas Esteban:** Básicamente de esa manera me quito estos todos estos problemas de los que les estaba hablando acá arriba.

**Braejan David Arias Heregua:** Sí, yo estoy yo estoy de acuerdo. Esta nos ayudaría muchísimo y sería una solución práctica que le permita al usuario seguir teniendo su su equivocación, por decirlo así, su parte de equivocación que pueda corregir.

**Daniel Enrique Rosas Esteban:** Listo. Ahora,

**Braejan David Arias Heregua:** Yeah.

**Daniel Enrique Rosas Esteban:** siguiendo el flujo que tenemos acá, eh, la producto, cantidad, unidad válida en tiempo real, existe una unidad correcta. No sé, este que llamaron ustedes aquí valida en tiempo real, yo no lo yo no lo dejaría en tiempo real. A a mi parecer, ¿en qué sentido? Yo lo que haría sería partir el proceso en dos etapas paralelas para no molestar al usuario en lo que está pasando. Entonces, yo dudo muchísimo por las pruebas que yo he hecho con inteligencia artificial y respuestas de API y absolutamente todo, que este procesamiento histórico demore más de 20 o 30 segundos en hacerse, ¿cierto? ¿A qué me refiero? de que cuando el usuario manda la información yene hay dos formas de hacerlo. Cuando cuando el modelo extrae toda la información para crear el registro de lo que se está haciendo y otra parte del proceso es cuando el programa está investigando en las bases de datos y usando los modelos matemáticos y estadísticos pertinentes para encontrar si ese registro va a ser una anomalía o no.

### **01:29:26**

**Daniel Enrique Rosas Esteban:** Son dos cosas completamente aparte y lo que se podría plantear sería que él pueda ir registrando con voz de forma normal y el programa por detrás vaya validando cada uno de los registros a su ritmo sin tener que dañarle la experiencia al usuario de partirle la pantalla. ¿Sí me va a entender?

**Braejan David Arias Heregua:** Ah. Ah. Sí. Y ahí tenía se conecta con lo que yo estaba diciendo de de que lo hiciéramos como de cierta forma por eventos, ¿no? como que bueno, el usuario registró algo y se da un evento y se hace la validación,

**Daniel Enrique Rosas Esteban:** M.

**Braejan David Arias Heregua:** pero what about the error, o sea, ¿qué pasa si si se efectó la anomalía, si ese lo que sea que que valía?

**Daniel Enrique Rosas Esteban:** Listo. Entonces,

**Braejan David Arias Heregua:** Aunque bueno, antes de continuar,

**Daniel Enrique Rosas Esteban:** claro.

**Braejan David Arias Heregua:** creo que esto también sería un nice to have porque actualmente esto pasa horas y días después, No,

**Daniel Enrique Rosas Esteban:** Exacto. Entonces, ¿qué debería pasar? se crea el registro, es decir, no hay un una regla estricta que impida la creación del registro, sino que el registro se crea, obviamente con lo que les estaba contando de tener tres modelos que validen la información que ingresa por voz, ta ta ta ta, para que el registro se cree y tenga fiabilidad del 99,92% del que estábamos hablando.

### **01:30:46**

**Daniel Enrique Rosas Esteban:** Y luego una vez creado el registro se dispara el trigger de validación. Y mientras el usuario puede seguir registrando, el trigger de validación, va a ir revisando cada uno de estos de estos eventos que pasaron, cada uno de estos registros, si tienen concordancia o no tienen concordancia con lo que va pasando anteriormente. Una vez el evento de validación encuentre una advertencia, porque no es un error, un error es algo que está mal, una advertencia es algo que requiere atención del usuario, se le señale en naranja y después de que termine de hacer la acción que está haciendo, que probablemente sea grabar un audio para que no le parta el audio a la mitad, entonces termina de grabar el audio, el audio envía la solicitud para hacer el registro, pero antes de dejarlo volver a disparar otro audio se le genere un letrero de advertencia y un un bloqueo preventivo que le dice el registro tal a la hora tal. Se le pone en pantalla en primera plana en naranjita, que lo lleve directamente al registro. Tiene una disonancia. Usualmente tenemos x cantidad de o tenemos se usa x cantidad de unidades o se usa por cajas o se usa por gramos o se usa por kilos y tú me lo acabaste de dictar en eh gramos.

### **01:32:13** {#01:32:13}

**Daniel Enrique Rosas Esteban:** Por favor solucione este esta inconsistencia antes de continuar.

**Braejan David Arias Heregua:** inconsistencia.

**Daniel Enrique Rosas Esteban:** ¿Listo?

**Braejan David Arias Heregua:** Y ahí volvemos al mismo al mismo del queamos hablado.

**Daniel Enrique Rosas Esteban:** Y así borre,

**Braejan David Arias Heregua:** Borras y vuelves y envias un Sí,

**Daniel Enrique Rosas Esteban:** borre y vuelva y me lo dicta,

**Braejan David Arias Heregua:** sí, sí.

**Daniel Enrique Rosas Esteban:** que eventualmente se puede optimizar,

**Braejan David Arias Heregua:** M.

**Daniel Enrique Rosas Esteban:** sí, pero en este punto de MVP no nos podemos poner a decirle, "Modifíqueme aquí, modifíqueme allá, porque si el día del MVP llegamos y a la IA le da justamente en el pitch la ganas de alucinar, nos vamos

**Braejan David Arias Heregua:** Bueno, igual por eso es que es importante que grabemos el video, ¿no?

**Daniel Enrique Rosas Esteban:** Ah.

**Braejan David Arias Heregua:** que el tema es como algo puede malir sal, pero también que tengamos un video como lo recomiendan. Creo que eso también nos puede ayudar,

**Daniel Enrique Rosas Esteban:** Sí,

**Braejan David Arias Heregua:** pero pero tienes toda la

**Daniel Enrique Rosas Esteban:** a mí lo que me me generaría el conflicto es que nosotros estemos hablando de tenemos un

**Braejan David Arias Heregua:** razón.

### **01:33:06**

**Daniel Enrique Rosas Esteban:** 99.92% de precisión y ese 0.08 pasa en el pit.

**Braejan David Arias Heregua:** Ah,

**Daniel Enrique Rosas Esteban:** Me cago

**Braejan David Arias Heregua:** sí, sí, sí. Bueno, no, no,

**Daniel Enrique Rosas Esteban:** en

**Braejan David Arias Heregua:** yo creo que de cierta forma eh o sea, como que todo esto también está tratándose precisamente a hacer un harness eh del proceso y y obviamente a veces se sale, pero pero yo creo que lo estamos jarneseando bien.

**Daniel Enrique Rosas Esteban:** Pues con cierta flexibilidad, ¿cierto? La flexibilidad es usted puede dictar ya no tiene que escribir.

**Braejan David Arias Heregua:** Claro.

**Daniel Enrique Rosas Esteban:** Esa es la flexibilidad que le estoy dando,

**Braejan David Arias Heregua:** Sí, sí, sí, sí.

**Daniel Enrique Rosas Esteban:** ¿no?

**Braejan David Arias Heregua:** Yeah.

**Daniel Enrique Rosas Esteban:** Entonces digamos que eso sería el proceso para grabar el inventario, básicamente. Claro, aquí lo que te digo, cuando esto falle, entonces se va a ir a hacer un validaciones en el en la base de datos.

**Braejan David Arias Heregua:** Sí, la lógica de ese trigger y ese trigger pues de ahí en adelante es que puede hacer más, o sea, puede ser hogs, pueden ser muchas cosas de ahí en adelante que se quieran eh y lo mismo arranquemos o bueno, no sé que esta reunión ya se nos alargó, pero digo, esas validaciones creo que si ya las podemos os profundizar un poquito mañana, pero por ahora es como este marco general de de lo que queremos construir y y

### **01:34:30**

**Braejan David Arias Heregua:** bueno, yo de verdad que Daniel tu aporte ha sido una vaina increíble, o sea, muchas cosas yo no no las tenía ni siquiera es que ni las pensaba.

**Daniel Enrique Rosas Esteban:** Sí, es que dice mi jefa, por eso nosotros somos analistas de procesos y no programadores, porque nosotros nos metemos hasta la cocina para saber cómo funciona todo antes de escribir código. Y sí siento que muchas veces a los ingenieros de sistemas que solo programan les hace

**Braejan David Arias Heregua:** Sí,

**Daniel Enrique Rosas Esteban:** mucha falta vaya métase allá a la cocina y vea cómo se hacen las cosas antes de inventarse un

**Braejan David Arias Heregua:** y entienda. Sí, sí, sí. y sienta el dolor. Sin duda,

**Daniel Enrique Rosas Esteban:** software.

**Braejan David Arias Heregua:** sentir el dolor es lo que uno hace, que uno tenga esa empatía de solucionar algo que verdad es un

**Daniel Enrique Rosas Esteban:** Exacto.

**Braejan David Arias Heregua:** fastidio.

**Daniel Enrique Rosas Esteban:** Entonces, pues básicamente sería, o sea, este es el flujo que yo estaba que se me ocurrió, ¿sí?

**Braejan David Arias Heregua:** Sí,

**Daniel Enrique Rosas Esteban:** Que puedo generar,

**Braejan David Arias Heregua:** sí,

**Daniel Enrique Rosas Esteban:** no sé.

### **01:35:20**

**Braejan David Arias Heregua:** sí,

**Daniel Enrique Rosas Esteban:** Entonces, ya. A ver, anomalía, lista, limpia, listo, es por el reporte.

**Braejan David Arias Heregua:** eso sería nice to have, o sea, el el poder exportar como ellos mismos nos dijeron. Yo estoy seguro que es que con esta organización y haciendo unas buenas specs,

**Daniel Enrique Rosas Esteban:** Bueno,

**Braejan David Arias Heregua:** eh, nos va a dar tiempo el sábado para hacer más cositas. Bueno, no lo estoy seguro, digo, espero que sea así al menos, pero la verdad es que yo sí me sentía muy un poco perdido hoy y creo que esto sí me me aterriza, o sea, como que ya sé mañana a qué me voy a levantar a hacer, ¿sabes?

**Daniel Enrique Rosas Esteban:** Ah, bueno, me alegra porque yo mañana también trabajo.

**Braejan David Arias Heregua:** No, de verdad que tu aporte ha sido increíble, o sea, mejor dicho, el sábado creo que va a ser un día también para divertirnos un poco y también conocernos un poco más y y demás, pero pero tu aporte ha sido

**Daniel Enrique Rosas Esteban:** Vale, muchas, muchas gracias.

**Braejan David Arias Heregua:** increíble,

**Daniel Enrique Rosas Esteban:** Ahí se siente uno bien cuando reconocen que pues de sentir que está aportando cosas valiosas al equipo.

### **01:36:23**

**Braejan David Arias Heregua:** ¿no?

**Daniel Enrique Rosas Esteban:** E bueno,

**Braejan David Arias Heregua:** De una.

**Daniel Enrique Rosas Esteban:** ahora cómo descargo esta vuelta para ponerla allá.

**Braejan David Arias Heregua:** Eh, sí, sácale un pantallazo o algo. Igual eh voy a esperar a que esté la transcripción.

**Adriana Durand Calle:** ¿Ustedes

**Braejan David Arias Heregua:** La verdad estoy muy muy cansado, pero si no lo hago temprano en la mañana. El resumir a qué acordamos acá,

**Daniel Enrique Rosas Esteban:** Mhm.

**Braejan David Arias Heregua:** a qué llegamos y vámonos con eso. O sea, no no le demos más vueltas. Creo que que ya tenemos un norte.

**Adriana Durand Calle:** dos van a ir físic,

**Daniel Enrique Rosas Esteban:** Listo.

**Adriana Durand Calle:** o sea, van a ir presencial O solo tú,

**Braejan David Arias Heregua:** Solo yo,

**Adriana Durand Calle:** Brian.

**Braejan David Arias Heregua:** solo yo.

**Daniel Enrique Rosas Esteban:** Él vive en Bogotá y yo vive en Medellín,

**Adriana Durand Calle:** Ah.

**Daniel Enrique Rosas Esteban:** entonces es más difícil.

**Braejan David Arias Heregua:** No, yo ni siquiera vio en Bogotá, yo vio en Aguazul Casanare. Pero viajé anoche,

### **01:37:08**

**Daniel Enrique Rosas Esteban:** Ah,

**Braejan David Arias Heregua:** por eso es que estoy que me duermo. Es que llegué a la 1 de la mañana a Bogotá, ¿eh? Pero no, no hay lío.

**Daniel Enrique Rosas Esteban:** ok.

**Braejan David Arias Heregua:** Sí, ya se me está fritando el cerebro. Lo que decía ellos, para mí sí me pasa. Yo tras noché mucho en bancos, mucho. A veces me dan dos, tres de la mañana, a veces no. Entonces siento que en parte también ya me quemé un montón y y bueno, ahorita trato de cuidar un poco también más mi integridad física,

**Daniel Enrique Rosas Esteban:** No, yo yo sí la integridad física no tengo, integridadía mental menos. Yo trabajo, estudio,

**Braejan David Arias Heregua:** Pero

**Daniel Enrique Rosas Esteban:** me meto a todos los proyectos que encuentro, soy líder de innovación en la empresa donde estoy. Entonces, ahorita saque pasear a la perra, vuelva, termine de hacer el diplomado en seguridad de la información que está haciendo y si le da tiempito, entonces mañana se para a las 4 de la mañana a terminar un modelo de inteligencia artificial que también estamos implementando en la empresa productal.

### **01:38:02**

**Braejan David Arias Heregua:** yo trabajaba con un con un compañero que era de Pereira. Aisa también mucha risa que decía, "Ah, es que estos muchachos de 20 sí son una cosa loca, ¿eh? No, bueno, Daniel, pues nada, eh, de verdad miro lo que haces. Muchas gracias por el tiempo que nos que nos has sacado también acá y nada, pues está está buenísimo todo, pero pues también de cierta forma no te olvides de ti, no te olvides de de comer bien, de dormir bien,

**Daniel Enrique Rosas Esteban:** Ah,

**Braejan David Arias Heregua:** que eso es importante.

**Daniel Enrique Rosas Esteban:** yo descanso el día que me muera. decía mi abuela.

**Braejan David Arias Heregua:** Eso es. Me acordas mucho,

**Daniel Enrique Rosas Esteban:** El problema es que capaz me muero temprano.

**Braejan David Arias Heregua:** compañero, con el trabajo,

**Daniel Enrique Rosas Esteban:** Eh,

**Braejan David Arias Heregua:** pero bueno, da súper. Muchas gracias. Creo que estamos así.

**Daniel Enrique Rosas Esteban:** estamos hablando con mucho

**Adriana Durand Calle:** Gracias, Daniel.

**Braejan David Arias Heregua:** Trataré de poner la información en grupo de WhatsApp.

### **01:38:50** {#01:38:50}

**Braejan David Arias Heregua:** Ya está un poco tarde,

**Daniel Enrique Rosas Esteban:** gusto.

**Braejan David Arias Heregua:** pero espero hacerlo lo más pronto posible.

**Daniel Enrique Rosas Esteban:** Listo.

**Braejan David Arias Heregua:** Igual, Daniel, lo que pueda subir allí al a la carpeta compartida.

**Daniel Enrique Rosas Esteban:** La idea sería Listo.

**Braejan David Arias Heregua:** Voilà. Deón.

**Daniel Enrique Rosas Esteban:** Eh, igual la idea de mañana sería entonces poder hacerle, yo sé que Edit tiene como más experiencia en eso. Entonces, si Adriana y Edit pudieran trabajar en el levantamiento de pues todo el flujo de trabajo que yo expliqué es como la reunión con cliente, ¿cierto? O sea, esto es como una especie de la reunión con un cliente y sería traducir eso a requerimientos técnicos funcionales y requerimientos no func requerimientos funcionales y requerimientos no funcionales para tener un mapeo y revisarlo.

**Braejan David Arias Heregua:** Sí,

**Daniel Enrique Rosas Esteban:** Yo mañana almuerzo a las

**Braejan David Arias Heregua:** pues lo primero, lo primero eso, eso te iba a decir como qué espacioscito tienes,

**Daniel Enrique Rosas Esteban:** 2\.

**Braejan David Arias Heregua:** porque realmente lo que primero queremos concretar todos es el PRD antes de pasar a especificar, o sea, que el documento de requerimiento de producto tenga todo esto. O sea, incluso yo lo que pretendo es hacer un mermate con todo esto y que lo revisemos,

### **01:39:47**

**Daniel Enrique Rosas Esteban:** Ajá.

**Braejan David Arias Heregua:** digamos, mira, si no no se nos está escapando nada.

**Daniel Enrique Rosas Esteban:** Sí.

**Braejan David Arias Heregua:** Pero pero aprobemos el PRD, creo yo, ¿no? O sea, esa es mi propuesta, que todos estemos de acuerdo con el PRD, ¿no? No es como que escrito en mármol, pero sí es el horizonte inicial antes de especificar,

**Daniel Enrique Rosas Esteban:** Sí, listo. Sería eso

**Braejan David Arias Heregua:** porque yo tengo experiencia con Open Spec,

**Daniel Enrique Rosas Esteban:** literalmente.

**Braejan David Arias Heregua:** eh, trabajando con Open Spec y pero a partir de un PR. Eh,

**Daniel Enrique Rosas Esteban:** Y

**Braejan David Arias Heregua:** y bueno, acá han explicado kit,

**Daniel Enrique Rosas Esteban:** sí,

**Braejan David Arias Heregua:** pero pues tampoco quiero irme a hacer algo nuevo lo que tú mencionabas. Es como usar una herramienta que uno en este momento no domina tanto, pues hasta que no haga el curso y lo aprenda,

**Adriana Durand Calle:** Ok.

**Braejan David Arias Heregua:** creo que puede ser

**Daniel Enrique Rosas Esteban:** te demoras más aprendiendo la que haciendo las cosas en Excel.

**Braejan David Arias Heregua:** contraproducente.

### **01:40:35**

**Daniel Enrique Rosas Esteban:** Decía mi jefa, usted me va a hacer una automatización en Python y yo necesito esto en media hora. Démelo que yo lo hago en Excel y listo. Y ya después me lo automatizo. Entonces, démelo que lo sacamos como sea y ya después del domingo miramos.

**Braejan David Arias Heregua:** También trabajado.

**Daniel Enrique Rosas Esteban:** Si ganamos, entonces pulimos todo lo que haya que pulir.

**Braejan David Arias Heregua:** Sí, de una. Yo yo tengo el proceso claro para trabajarlo con Open Spec.

**Daniel Enrique Rosas Esteban:** Bueno,

**Braejan David Arias Heregua:** Eh, trabajo con Engram, no sé si también lo conoces de pronto.

**Daniel Enrique Rosas Esteban:** mira, mira, tú ahorita me estás hablando en chino. Yo no sé qué es open, yo no sé qué es engram, yo sé de este tipo de cosas.

**Braejan David Arias Heregua:** Va,

**Daniel Enrique Rosas Esteban:** Me meto al lodo,

**Braejan David Arias Heregua:** va,

**Daniel Enrique Rosas Esteban:** hago cosas y luego me voy con la I a programar.

**Braejan David Arias Heregua:** bien, bien. Yo yo estoy claro, en la otra parte tengo más experiencia porque trabajé más con startuperos en donde las personas con las que trabajaba era más como tu rol y era como bueno, yo sé que esto se puede hacer, pero es esto, esto y esto y esto y cómo no sé ahorita, pero yo sé que se puede.

### **01:41:26** {#01:41:26}

**Daniel Enrique Rosas Esteban:** mañana resuelvo. ¿Listo? No, entonces sería eso. Recuerden que la idea también sería eh sacar un plan de QUA robusto para esto. Posiblemente Edit sepa más del tema de qua,

**Adriana Durand Calle:** Bien.

**Daniel Enrique Rosas Esteban:** pero como es qua para inteligencia artificial tiene un enfoque distinto. de si si Adri y Edit que o sea, lo digo más que todo porque como Brian y yo vamos a estar programando y en esa programación pues vamos a

**Adriana Durand Calle:** Ok.

**Daniel Enrique Rosas Esteban:** durar tiempo muerto que probablemente no nos estemos comunicando constantemente con ustedes. es lo ideal. sería que formáramos ese grupo. Ustedes ayudan a armar los documentos iniciales de producto de todo lo que hemos estado hablando, darle forma a esto junto con Brian. Mañana a las 2 lo podemos mirar. Yo almuerzo a esa hora, entonces podemos tener una reunión a esa hora sin ningún tipo de problema. Aprobamos cosas, seguimos trabajando a lo largo del día. A partir de la noche, mañana a las 5 de la tarde, yo ya estoy libre para poder empezar a programar junto con Brian. A partir de mañana en la noche empezaríamos a darle durísimo él y yo a la programación y ustedes a montar, digamos, recursos, casos de uso, casos específicos, qué tiene que salir bien,

**Adriana Durand Calle:** no

**Daniel Enrique Rosas Esteban:** cómo tiene que salir bien. De pronto un esquema de cómo vamos a ir haciendo el pit o lo podemos revisar también el sábado por la tarde para que sea un trabajo complementario, que ustedes sean las auditoras completas de todo lo que Brian y yo vayamos construyendo. No sé si les parece bien como esa distribución.

**Adriana Durand Calle:** Sí.

**Braejan David Arias Heregua:** Sí.

**Adriana Durand Calle:** Eh,

**Daniel Enrique Rosas Esteban:** Listo.

**Adriana Durand Calle:** perfecto.

**Daniel Enrique Rosas Esteban:** Señores, entonces los dejo que mi perrita me está pidiendo ya que la saque.

**Braejan David Arias Heregua:** Claro que sí. Eh, tengan muy buena noche de nuevo.

**Adriana Durand Calle:** Gracias, Daniel. Gracias,

**Braejan David Arias Heregua:** Gracias,

**Adriana Durand Calle:** Brian.

**Daniel Enrique Rosas Esteban:** Ale Ah.

**Adriana Durand Calle:** Coao.

**Braejan David Arias Heregua:** gracias por su tiempo.

### **La transcripción finalizó después de 01:43:15**

*Esta transcripción editable se generó por computadora y puede contener errores. Los usuarios también pueden cambiar el texto después de que se cree.*