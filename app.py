import uvicorn
from fastapi import FastAPI, Form, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates

from models import Complaint, complaints


app = FastAPI()
templates = Jinja2Templates(directory="templates")


@app.get("/", response_class=HTMLResponse)
def home(request: Request) -> HTMLResponse:
    return templates.TemplateResponse(request=request, name="home.html")


@app.get("/complaints", response_class=HTMLResponse)
def board(request: Request) -> HTMLResponse:
    return templates.TemplateResponse(
        request=request, name="complaints.html", context={"complaints": complaints}
    )


@app.post("/complaints")
def add_complaint(agent_name: str = Form(), text: str = Form()) -> RedirectResponse:
    complaints.append(Complaint(agent_name, text))
    return RedirectResponse("/complaints", status_code=303)


if __name__ == "__main__":
    uvicorn.run("app:app", reload=True)
