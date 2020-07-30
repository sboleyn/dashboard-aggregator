import express from "express";
import { Client } from "pg";

import * as config from "./configuration";
import logger, { errorLogger, requestLogger } from "./logging";
import recentlyAddedHandler, {
    getData as recentlyAddedData,
} from "./apps/recentlyAdded";
import publicAppsHandler, { getData as publicAppsData } from "./apps/public";
import recentAnalysesHandler, {
    getData as recentAnalysesData,
} from "./analyses/recent";
import runningAnalysesHandler, {
    getData as runningAnalysesData,
} from "./analyses/running";

import WebsiteFeed, { feedURL, VideoFeed } from "./feed";

logger.info("creating database client");

// Set up the database connection. May have to change to a Pool in the near future.
const db = new Client({
    host: config.dbHost,
    user: config.dbUser,
    password: config.dbPass,
    database: config.dbDatabase,
    port: config.dbPort,
});

db.connect();

// Populate feeds from the website.
const newsFeed = new WebsiteFeed(
    feedURL(config.websiteURL, config.newsFeedPath)
);
newsFeed.pullItems(); // populate the local copy.
newsFeed.scheduleRefresh().start(); // schedule the refresh of the local copy.

const eventsFeed = new WebsiteFeed(
    feedURL(config.websiteURL, config.eventsFeedPath)
);
eventsFeed.pullItems();
eventsFeed.scheduleRefresh().start();

const videosFeed = new VideoFeed(config.videosURL);
videosFeed.pullItems();
videosFeed.scheduleRefresh().start();

logger.info("setting up the express server");
const app = express();

app.use(errorLogger);
app.use(requestLogger);

const createFeeds = async (limit) => {
    const newsItems = await newsFeed.getItems();
    const eventsItems = await eventsFeed.getItems();
    const videosItems = await videosFeed.getItems();

    return {
        news: newsItems.slice(0, limit),
        events: eventsItems.slice(0, limit),
        videos: videosItems.slice(0, limit),
    };
};

/**
 * Health check handler. Should be used by liveness and readiness checks.
 */
app.get("/healthz", async (req, res) => {
    const { rows } = await db
        .query("select version from version order by applied desc limit 1")
        .catch((e) => logger.error(e));

    if (!rows) {
        res.status(500).send("no rows returned from database");
        return;
    }

    res.status(200).send(`version ${rows[0].version}`);
});

app.get("/users/:username/apps/recently-added", recentlyAddedHandler(db));
app.get("/users/:username/analyses/recent", recentAnalysesHandler(db));
app.get("/users/:username/analyses/running", runningAnalysesHandler(db));
app.get("/users/:username", async (req, res) => {
    try {
        const username = req.params.username;
        const limit = parseInt(req?.query?.limit ?? "10", 10);
        const feeds = await createFeeds(limit);

        const retval = {
            apps: {
                recentlyAdded: await recentlyAddedData(db, username, limit),
                public: await publicAppsData(db, limit),
            },
            analyses: {
                recent: await recentAnalysesData(db, username, limit),
                running: await runningAnalysesData(db, username, limit),
            },
            feeds,
        };

        res.status(200).json(retval);
    } catch (e) {
        logger.error(e);
        res.status(500).send(`error running query: ${e}`);
    }
});

app.get("/", async (req, res) => {
    try {
        const limit = parseInt(req?.query?.limit ?? "10", 10);
        const feeds = await createFeeds(limit);

        const retval = {
            apps: {
                public: await publicAppsData(db, limit),
            },
            feeds,
        };
        res.status(200).json(retval);
    } catch (e) {
        logger.error(e.message);
        res.status(500).send(`error running query: ${e.message}`);
    }
});

app.get("/feeds", async (req, res) => {
    try {
        const limit = parseInt(req?.query?.limit ?? "10", 10);
        const feeds = await createFeeds(limit);

        res.status(200).json({
            feeds,
        });
    } catch (e) {
        logger.error(e.message);
        res.status(500).send(`error getting feeds: ${e.message}`);
    }
});

app.get("/apps/public", publicAppsHandler(db));

/**
 * Start up the server on the configured port.
 */
app.listen(config.listenPort, (err) => {
    if (err) throw err;
    console.log(`> Ready on http://localhost:${config.listenPort}`);
});
