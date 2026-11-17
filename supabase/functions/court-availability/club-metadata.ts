import type { Club } from "./data.ts";

// Public court metadata verified on 2026-11-17. Contains no slot availability.
// Unmapped provider court IDs remain excluded by normalizeAvailability.
export const fallbackClub: Club = {
  courts: [
    {"id": "88801221-e24c-420c-9f44-98209675546e", "name": "GEIGER Court 1", "location": "outdoor"},
    {"id": "2076aa23-52cb-4ebe-aaaf-a050b84c4202", "name": "CUPRA Court 2", "location": "outdoor"},
    {"id": "8b83cd3c-a998-427c-b60c-a14f20e9bb2a", "name": "CUPRA Court 3", "location": "outdoor"},
    {"id": "54a3822d-7772-4447-b2c2-f6f7a78967ce", "name": "DAS ANDERS Court 4", "location": "outdoor"},
    {"id": "1f343d4c-45b7-4cb3-a4d0-be41a196d10c", "name": "CUPRA Court 5", "location": "outdoor"},
    {"id": "34181566-cc2d-4af8-b102-fc05ed1045d7", "name": "CUPRA Court 6", "location": "outdoor"},
    {"id": "d118983f-c557-4117-ace8-dd078f81718f", "name": "Court 7", "location": "outdoor"},
    {"id": "6ebc6f1a-14cc-4554-ac0a-b35d13f9f3f4", "name": "CUPRA Court 8", "location": "outdoor"},
    {"id": "7ec5ac16-73a1-4bc6-ad62-f0380593353d", "name": "Court 9", "location": "outdoor"},
    {"id": "11dabe24-bf80-4ea2-bbc0-ba0632b3bf21", "name": "Court 10", "location": "outdoor"},
    {"id": "f7c7e37a-1fce-4b29-b3b1-41601f1f591c", "name": "CUPRA Indoor H1", "location": "indoor"},
    {"id": "8778f800-6d2d-46d8-b2b5-fbe35d9ad5b5", "name": "Indoor H2", "location": "indoor"},
    {"id": "ca99238e-ea6f-41e7-bafb-1fd67acc694c", "name": "Indoor H3", "location": "indoor"},
    {"id": "4aeb17f7-868f-4389-bb6e-4828dd0e61da", "name": "CUPRA Indoor H4", "location": "indoor"},
  ],
  openingHours: Object.fromEntries(["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"]
    .map(day => [day, { opening_time: "07:00", closing_time: "00:00" }])),
};
