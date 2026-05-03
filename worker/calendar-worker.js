const USER_EVENTS_KEY = "calendar:user-events";
const SCHEDULED_EVENTS_URL = "https://calendar.hoos.org/scheduled-events.json";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }

    if (url.pathname === "/calendar.ics") {
      if (request.method !== "GET") {
        return new Response("Method not allowed", {
          status: 405,
          headers: corsHeaders(),
        });
      }

      return getIcsCalendar(env);
    }

    if (url.pathname === "/events") {
      return getEvents(env);
    }

    if (url.pathname === "/edit/events") {
      if (request.method === "GET") return getEvents(env);
      if (request.method === "POST") return saveEvents(request, env);

      return new Response("Method not allowed", {
        status: 405,
        headers: corsHeaders(),
      });
    }

    return new Response("Not found", { status: 404 });
  },
};

async function getIcsCalendar(env) {
  const [scheduledEvents, userEvents] = await Promise.all([
    getScheduledEvents(),
    getUserEvents(env),
  ]);
  const eventsById = new Map();

  for (const event of [...scheduledEvents, ...userEvents]) {
    if (isValidEvent(event)) eventsById.set(String(event.id), event);
  }

  const events = [...eventsById.values()].sort((a, b) =>
    `${a.date}T${a.start || ""}`.localeCompare(`${b.date}T${b.start || ""}`)
  );

  return new Response(buildIcs(events), {
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "cache-control": "no-cache, no-store, must-revalidate",
      "content-disposition": 'inline; filename="custody-calendar.ics"',
      ...corsHeaders(),
    },
  });
}

async function getEvents(env) {
  const userEvents = await getUserEvents(env);

  return new Response(JSON.stringify(userEvents), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...corsHeaders(),
    },
  });
}

async function getScheduledEvents() {
  const response = await fetch(SCHEDULED_EVENTS_URL, {
    headers: { accept: "application/json" },
  });

  if (!response.ok) return [];

  const events = await response.json();
  return Array.isArray(events) ? events : [];
}

async function getUserEvents(env) {
  const json = await env.CALENDAR_KV.get(USER_EVENTS_KEY);
  if (!json) return [];

  try {
    const events = JSON.parse(json);
    return Array.isArray(events) ? events : [];
  } catch {
    return [];
  }
}

async function saveEvents(request, env) {
  let events;

  try {
    events = await request.json();
  } catch {
    return new Response("Invalid JSON", {
      status: 400,
      headers: corsHeaders(),
    });
  }

  if (!Array.isArray(events)) {
    return new Response("Expected an array", {
      status: 400,
      headers: corsHeaders(),
    });
  }

  const userEvents = events.filter((event) =>
    String(event.id || "").startsWith("usr-")
  );

  await env.CALENDAR_KV.put(USER_EVENTS_KEY, JSON.stringify(userEvents));

  return new Response(JSON.stringify({ ok: true }), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...corsHeaders(),
    },
  });
}

function buildIcs(events) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Declan & Tiernan Custody Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Declan & Tiernan Custody Calendar",
    "X-WR-TIMEZONE:America/Los_Angeles",
  ];

  for (const event of events) {
    const kid = event.kid === "both"
      ? "Both"
      : capitalize(String(event.kid || "event"));
    const summary = `[${kid}] ${event.title || "Calendar event"}`;

    lines.push(
      "BEGIN:VEVENT",
      `UID:${escapeIcsText(event.id)}@calendar.hoos.org`,
      `DTSTAMP:${utcStamp(new Date())}`,
      `DTSTART:${dateTimeStamp(event.date, event.start || "00:00")}`,
      `DTEND:${dateTimeStamp(event.date, event.end || event.start || "23:59")}`,
      `SUMMARY:${escapeIcsText(summary)}`,
      `DESCRIPTION:${escapeIcsText(event.notes || "")}`,
      "END:VEVENT"
    );
  }

  lines.push("END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}

function isValidEvent(event) {
  return event
    && event.id
    && /^\d{4}-\d{2}-\d{2}$/.test(String(event.date || ""))
    && event.title;
}

function dateTimeStamp(date, time) {
  const [year, month, day] = String(date).split("-");
  const [hour = "00", minute = "00"] = String(time).split(":");
  return `${year}${month}${day}T${hour.padStart(2, "0")}${minute.padStart(2, "0")}00`;
}

function utcStamp(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function escapeIcsText(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/\r?\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function capitalize(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : value;
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  };
}
