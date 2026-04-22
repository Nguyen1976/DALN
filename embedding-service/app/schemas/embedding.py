from pydantic import BaseModel


class UserData(BaseModel):
    id: str
    bio: str
    age: int


class BioBatch(BaseModel):
    users: list[UserData]
