from app.application import create_app

app = create_app()

if __name__ == "__main__":
    from importlib import import_module

    uvicorn = import_module("uvicorn")
    uvicorn.run(app, host="0.0.0.0", port=8000, access_log=False)