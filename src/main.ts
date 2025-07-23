import express, { Application, Request, Response } from "express";
import Database from "./libs/prisma";
import ChatRouter from "./router/ChatRouter";
import cors from "cors"; 
require('dotenv').config();


class App {
  public app: Application;

  constructor() {
    this.app = express();
    this.plugins();
    this.routes();
    
  }

  protected plugins(): void {
    this.app.use(
      cors({
        origin: "http://localhost:3000", // or '*' to allow all origins
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      })
    );

    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));
  }

  protected routes(): void {
    this.app.route("/").get((req: Request, res: Response) => {
      res.send("welcome home");
    });
    this.app.use("/api/chat", ChatRouter);

  }
}

const port: number = 5000;
const app = new App().app;

app.listen(port, () => {
  console.log(" Server started successfully!");
});
