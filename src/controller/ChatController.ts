import { Request, Response } from "express";
import { chatWithGemini } from "../tools";

class ChatController {
  async postMessage(req: Request, res: Response) {
    try {
      const responseAI = await chatWithGemini( req.body.user_message , req.body.lat,req.body.lon);


      res.status(201).json({
        message: responseAI
      });
    } catch (err) {
      res.status(500).json({
        status: "Internal Server Error!",
        message: "Internal Server Error!",
      });
    }
  }
  
}

export default new ChatController()
