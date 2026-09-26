import { z } from "zod";
import { PageInput } from "../../core/pagination.ts";
import { id, optionalText } from "./common.ts";

const fields = {
  phone: optionalText(40),
  email: optionalText(200),
  organisation: optionalText(120),
  notes: optionalText(2000),
};

export const CreateClientInput = z.object({ name: z.string().trim().min(1).max(120), ...fields });
export const UpdateClientInput = z.object({
  client_id: id("Client"),
  name: z.string().trim().min(1).max(120).optional(),
  ...fields,
});
export const ClientRef = z.object({ client_id: id("Client") });
export const FindClientsInput = PageInput.extend({
  q: z.string().trim().max(120).optional().describe("Part of the client's name, phone or organisation"),
});

export interface ClientView {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  organisation: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}
